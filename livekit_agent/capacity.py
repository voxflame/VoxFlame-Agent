from __future__ import annotations

import asyncio
import fcntl
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Callable, Protocol

logger = logging.getLogger("voxflame-livekit-agent.capacity")


class AgentServerLike(Protocol):
    @property
    def active_jobs(self) -> list[object]: ...


class ProviderCapacityExceeded(RuntimeError):
    def __init__(self, provider: str, wait_timeout_seconds: float) -> None:
        super().__init__(
            f"{provider} capacity unavailable after {wait_timeout_seconds:.3f}s"
        )
        self.provider = provider
        self.wait_timeout_seconds = wait_timeout_seconds


@dataclass(frozen=True)
class WorkerLoadSnapshot:
    active_jobs: int
    job_pressure: float
    cpu_pressure: float
    memory_pressure: float
    combined_load: float


class WorkerLoadPolicy:
    """Convert job, CPU and memory pressure into LiveKit's 0..1 load signal."""

    def __init__(
        self,
        *,
        max_active_jobs: int,
        load_threshold: float,
        memory_limit_percent: float,
        cpu_percent: Callable[[], float] | None = None,
        memory_percent: Callable[[], float] | None = None,
    ) -> None:
        if max_active_jobs <= 0:
            raise ValueError("max_active_jobs must be positive")
        if not 0 < load_threshold <= 1:
            raise ValueError("load_threshold must be within (0, 1]")
        if not 0 < memory_limit_percent <= 100:
            raise ValueError("memory_limit_percent must be within (0, 100]")

        self.max_active_jobs = max_active_jobs
        self.load_threshold = load_threshold
        self.memory_limit_percent = memory_limit_percent
        self._cpu_percent = cpu_percent or self._read_cpu_percent
        self._memory_percent = memory_percent or self._read_memory_percent
        self._last_snapshot: WorkerLoadSnapshot | None = None

    @staticmethod
    def _read_cpu_percent() -> float:
        import psutil

        return float(psutil.cpu_percent(interval=0.1))

    @staticmethod
    def _read_memory_percent() -> float:
        import psutil

        return float(psutil.virtual_memory().percent)

    @property
    def last_snapshot(self) -> WorkerLoadSnapshot | None:
        return self._last_snapshot

    def __call__(self, server: AgentServerLike) -> float:
        active_jobs = len(server.active_jobs)
        job_pressure = min(
            self.load_threshold,
            active_jobs / self.max_active_jobs * self.load_threshold,
        )
        cpu_pressure = min(1.0, max(0.0, self._cpu_percent() / 100.0))
        memory_pressure = min(
            1.0,
            max(0.0, self._memory_percent() / self.memory_limit_percent)
            * self.load_threshold,
        )
        combined_load = min(1.0, max(job_pressure, cpu_pressure, memory_pressure))
        self._last_snapshot = WorkerLoadSnapshot(
            active_jobs=active_jobs,
            job_pressure=job_pressure,
            cpu_pressure=cpu_pressure,
            memory_pressure=memory_pressure,
            combined_load=combined_load,
        )
        return combined_load


@dataclass
class ProviderCapacityLease:
    provider: str
    slot: int
    file_descriptor: int
    waited_ms: int

    def release(self) -> None:
        if self.file_descriptor < 0:
            return
        try:
            fcntl.flock(self.file_descriptor, fcntl.LOCK_UN)
        finally:
            os.close(self.file_descriptor)
            self.file_descriptor = -1


class ProcessSlotPool:
    """Linux container-local capacity shared by independent Agent Job processes."""

    def __init__(
        self,
        *,
        provider: str,
        slots: int,
        wait_timeout_seconds: float,
        lock_directory: str,
        poll_interval_seconds: float = 0.025,
    ) -> None:
        if slots <= 0:
            raise ValueError("slots must be positive")
        if wait_timeout_seconds < 0:
            raise ValueError("wait_timeout_seconds must not be negative")
        if poll_interval_seconds <= 0:
            raise ValueError("poll_interval_seconds must be positive")

        self.provider = provider
        self.slots = slots
        self.wait_timeout_seconds = wait_timeout_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self.lock_directory = Path(lock_directory)
        self.lock_directory.mkdir(parents=True, exist_ok=True)

    def _try_acquire(self) -> ProviderCapacityLease | None:
        started_at = time.monotonic()
        deadline = started_at + self.wait_timeout_seconds
        while True:
            for slot in range(self.slots):
                lock_path = self.lock_directory / f"{self.provider}-{slot}.lock"
                file_descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
                try:
                    fcntl.flock(
                        file_descriptor,
                        fcntl.LOCK_EX | fcntl.LOCK_NB,
                    )
                except BlockingIOError:
                    os.close(file_descriptor)
                    continue

                return ProviderCapacityLease(
                    provider=self.provider,
                    slot=slot,
                    file_descriptor=file_descriptor,
                    waited_ms=round((time.monotonic() - started_at) * 1000),
                )

            if time.monotonic() >= deadline:
                return None
            time.sleep(self.poll_interval_seconds)

    async def acquire(self) -> ProviderCapacityLease:
        lease = await asyncio.to_thread(self._try_acquire)
        if lease is None:
            logger.warning(
                "Provider capacity exhausted provider=%s slots=%s wait_timeout_ms=%s",
                self.provider,
                self.slots,
                round(self.wait_timeout_seconds * 1000),
            )
            raise ProviderCapacityExceeded(self.provider, self.wait_timeout_seconds)

        logger.info(
            "Provider capacity acquired provider=%s slot=%s slots=%s waited_ms=%s",
            self.provider,
            lease.slot,
            self.slots,
            lease.waited_ms,
        )
        return lease

    @asynccontextmanager
    async def lease(self) -> AsyncIterator[ProviderCapacityLease]:
        lease = await self.acquire()
        try:
            yield lease
        finally:
            slot = lease.slot
            lease.release()
            logger.info(
                "Provider capacity released provider=%s slot=%s",
                self.provider,
                slot,
            )


def build_provider_pool(
    *,
    provider: str,
    slots: int,
    wait_timeout_seconds: float,
    lock_directory: str,
) -> ProcessSlotPool:
    return ProcessSlotPool(
        provider=provider,
        slots=slots,
        wait_timeout_seconds=wait_timeout_seconds,
        lock_directory=lock_directory,
    )
