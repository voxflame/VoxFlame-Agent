# Voice pipeline repair plan — 2026-09-10
Scope: existing livekit_agent runtime and focused tests; no deployment, credentials, model upgrades or firmware claims.
Source: installed LiveKit Agents 1.7.1 generation.py cancels forwarding tasks before clearing output, manual-turn example disables input while not listening; RTC 1.1.15 bounded capture backpressure. Preserve account dispatch, training capture IDs and non-typical speech.
1. Remove redundant unbounded TTS Python queue; bounded 20ms writes with SDK backpressure, cancel producer before clearing source, retain speaking state through playout.
2. Async HTTP LLM with cancellation and hard timeout; replace reply FIFO by cancellable latest-turn controller, finalize memory only for accepted output.
3. Detach HTTP recognition from audio consumption with bounded utterance work, immutable per-capture attribution including fallback, cancellation cleanup; bound capture and SDK backlog, explicit overflow errors rather than silent training loss.
4. Trusted explicit half-duplex policy (or safe default for automatic speech), input drop/reset during playback/tail; AEC fail-closed when reference path absent. Do not pretend server-only AEC compensates unknown hardware.
Tests: regression before/after, delayed provider, queued/late TTS, rapid turns, per-account/per-capture isolation, fallback failure, half-duplex, all Agent tests; documentation harness. Device AEC and real RTC audio require later smoke.
Rollback: revert this focused diff before release; production unchanged. Preserve unrelated working-tree changes.
