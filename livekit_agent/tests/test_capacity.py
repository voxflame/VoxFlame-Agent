from __future__ import annotations

import asyncio
import multiprocessing
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from capacity import ProcessSlotPool, ProviderCapacityExceeded, WorkerLoadPolicy


class FakeAgentServer:
    def __init__(self, active_jobs: int) -> None:
        self.active_jobs = [object() for _ in range(active_jobs)]


def _try_slot_from_child(lock_directory: str, result_queue: multiprocessing.Queue) -> None:
    async def run() -> None:
        pool = ProcessSlotPool(
            provider="llm",
            slots=1,
            wait_timeout_seconds=0.05,
            lock_directory=lock_directory,
            poll_interval_seconds=0.005,
        )
        try:
            async with pool.lease():
                result_queue.put("acquired")
        except ProviderCapacityExceeded:
            result_queue.put("exhausted")

    asyncio.run(run())


class CapacityTests(unittest.TestCase):
    def test_worker_stops_accepting_jobs_at_active_job_limit(self) -> None:
        policy = WorkerLoadPolicy(
            max_active_jobs=8,
            load_threshold=0.7,
            memory_limit_percent=85,
            cpu_percent=lambda: 10,
            memory_percent=lambda: 20,
        )

        load = policy(FakeAgentServer(active_jobs=8))

        self.assertEqual(load, 0.7)
        self.assertIsNotNone(policy.last_snapshot)
        self.assertEqual(policy.last_snapshot.active_jobs, 8)  # type: ignore[union-attr]

    def test_worker_accepts_an_eighth_job_when_other_resources_are_healthy(self) -> None:
        policy = WorkerLoadPolicy(
            max_active_jobs=8,
            load_threshold=0.7,
            memory_limit_percent=85,
            cpu_percent=lambda: 10,
            memory_percent=lambda: 20,
        )

        load = policy(FakeAgentServer(active_jobs=7))

        self.assertLess(load, 0.7)

    def test_cpu_or_memory_pressure_can_stop_admission_before_job_limit(self) -> None:
        cpu_policy = WorkerLoadPolicy(
            max_active_jobs=8,
            load_threshold=0.7,
            memory_limit_percent=85,
            cpu_percent=lambda: 82,
            memory_percent=lambda: 20,
        )
        memory_policy = WorkerLoadPolicy(
            max_active_jobs=8,
            load_threshold=0.7,
            memory_limit_percent=85,
            cpu_percent=lambda: 10,
            memory_percent=lambda: 85,
        )

        self.assertGreaterEqual(cpu_policy(FakeAgentServer(active_jobs=1)), 0.7)
        self.assertGreaterEqual(memory_policy(FakeAgentServer(active_jobs=1)), 0.7)

    def test_slot_is_reusable_after_release(self) -> None:
        with tempfile.TemporaryDirectory() as lock_directory:
            pool = ProcessSlotPool(
                provider="tts",
                slots=1,
                wait_timeout_seconds=0,
                lock_directory=lock_directory,
            )

            async def run() -> None:
                first = await pool.acquire()
                with self.assertRaises(ProviderCapacityExceeded):
                    await pool.acquire()
                first.release()
                second = await pool.acquire()
                second.release()

            asyncio.run(run())

    def test_slot_limit_is_shared_across_agent_job_processes(self) -> None:
        with tempfile.TemporaryDirectory() as lock_directory:
            pool = ProcessSlotPool(
                provider="llm",
                slots=1,
                wait_timeout_seconds=0,
                lock_directory=lock_directory,
            )

            async def run() -> None:
                lease = await pool.acquire()
                try:
                    context = multiprocessing.get_context("spawn")
                    result_queue = context.Queue()
                    process = context.Process(
                        target=_try_slot_from_child,
                        args=(lock_directory, result_queue),
                    )
                    process.start()
                    process.join(timeout=5)
                    self.assertFalse(process.is_alive())
                    self.assertEqual(process.exitcode, 0)
                    self.assertEqual(result_queue.get(timeout=1), "exhausted")
                finally:
                    lease.release()

            asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
