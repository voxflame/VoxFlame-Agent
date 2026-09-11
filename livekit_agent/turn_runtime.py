"""Single-owner conversation turns: cancel obsolete work, never replay a FIFO."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

logger = logging.getLogger('voxflame-livekit-agent.turn')


@dataclass(frozen=True)
class ReplyTurn:
    text: str
    correction_original: str | None = None


class ReplyTurnRunner:
    """One active task and one newest pending turn per room; no unbounded tasks."""

    def __init__(self, process: Callable[[ReplyTurn], Awaitable[None]]) -> None:
        self._process = process
        self._pending: ReplyTurn | None = None
        self._active: asyncio.Task[None] | None = None
        self._cancel_requested = False
        self._ready = asyncio.Event()
        self._closed = False
        self._worker = asyncio.create_task(self._run())

    def submit(self, turn: ReplyTurn) -> None:
        if self._closed or not turn.text.strip():
            return
        self.interrupt()
        self._pending = turn
        self._ready.set()

    def interrupt(self) -> None:
        self._pending = None
        if self._active is not None and not self._active.done():
            # Cancel once: repeated cancellation must not interrupt cleanup.
            if not self._cancel_requested:
                self._cancel_requested = True
                self._active.cancel()

    async def _run(self) -> None:
        while not self._closed:
            await self._ready.wait()
            self._ready.clear()
            turn, self._pending = self._pending, None
            if turn is None:
                continue
            self._cancel_requested = False
            self._active = asyncio.create_task(self._process(turn))
            try:
                await self._active
            except asyncio.CancelledError:
                if self._closed:
                    return
            except Exception as exc:
                logger.warning('Reply turn failed type=%s', type(exc).__name__)
            finally:
                self._active = None
            if self._pending is not None:
                self._ready.set()

    async def aclose(self) -> None:
        self._closed = True
        self.interrupt()
        self._ready.set()
        await self._worker
