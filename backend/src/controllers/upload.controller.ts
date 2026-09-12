import { Router } from 'express';
import { ossService } from '../services/oss.service';
import { uploadArtifactService } from '../services/upload-artifact.service';
import { uploadPathBelongsToContributor } from '../services/upload-path-policy';
import {
    admitCompletedUpload,
    requireCurrentLegalConsent,
    UploadAdmissionError,
    validateUploadSignInput,
} from '../services/upload-admission.service';
import { uploadCapacityMiddleware } from '../middlewares/upload-capacity.middleware';

const router = Router();

/**
 * GET /api/upload/progress
 * Return only identifiers and aggregate durations needed by recording UI.
 */
router.get('/progress', async (req, res) => {
    try {
        const contributorId = req.user?.id;
        if (!contributorId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const rawOffset = Array.isArray(req.query.timezoneOffsetMinutes)
            ? req.query.timezoneOffsetMinutes[0]
            : req.query.timezoneOffsetMinutes;
        const parsedOffset = typeof rawOffset === 'string' ? Number(rawOffset) : 0;
        const timezoneOffsetMinutes = Number.isFinite(parsedOffset) ? parsedOffset : 0;
        const progress = await uploadArtifactService.getRecordingProgress(
            contributorId,
            timezoneOffsetMinutes,
        );

        res.json(progress);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        console.error('[Upload] Progress error:', message);
        res.status(500).json({ error: message });
    }
});

/** Advance one article to a new account-level cycle without deleting audio. */
router.post('/reading/reset', async (req, res) => {
    try {
        const contributorId = req.user?.id;
        if (!contributorId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const articleId = typeof req.body?.articleId === 'string'
            ? req.body.articleId.trim()
            : '';
        if (!/^reading-\d{3}$/.test(articleId)) {
            return res.status(400).json({ error: 'Invalid articleId' });
        }

        const result = await uploadArtifactService.resetReadingArticleProgress(
            contributorId,
            articleId,
        );
        res.json(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        console.error('[Upload] Reading reset error:', message);
        res.status(500).json({ error: message });
    }
});

/**
 * POST /api/upload/sign
 * Generate a signed URL for client-side upload
 */
router.post('/sign', uploadCapacityMiddleware('sign'), async (req, res) => {
    try {
        const { filename, contentType } = req.body ?? {};
        const contributorId = req.user?.id;

        if (!contributorId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        requireCurrentLegalConsent(req.user?.userMetadata);
        const admitted = validateUploadSignInput(filename, contentType);
        if (!uploadPathBelongsToContributor(admitted.filename, contributorId)) {
            return res.status(403).json({ error: 'Upload path does not belong to authenticated user' });
        }

        const url = await ossService.generateUploadUrl(admitted.filename, admitted.contentType);

        if (!url) {
            return res.status(503).json({ error: 'OSS service unavailable' });
        }

        res.json({ url });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        const status = error instanceof UploadAdmissionError ? error.status : 500;
        console.error('[Upload] Sign error:', message);
        res.status(status).json({ error: message });
    }
});

/**
 * POST /api/upload/complete
 * Notify backend that upload is finished. 
 * 1. Insert into Database
 * 2. Append to OSS transcript manifest
 */
router.post('/complete', uploadCapacityMiddleware('complete'), async (req, res) => {
    try {
        const {
            audioPath,
            text,
            recognizedText,
            sentenceId,
            duration,
            source,
            metadata
        } = req.body ?? {};
        const contributorId = req.user?.id;

        if (!contributorId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!uploadPathBelongsToContributor(audioPath, contributorId)) {
            return res.status(403).json({ error: 'Upload path does not belong to authenticated user' });
        }

        const consent = requireCurrentLegalConsent(req.user?.userMetadata);
        const object = await ossService.inspectObject(audioPath);
        const admitted = admitCompletedUpload({
            audioPath,
            text,
            duration,
            metadata,
        }, object, consent);

        const result = await uploadArtifactService.persistCompletedUpload({
            contributorId,
            audioPath: admitted.audioPath,
            text: admitted.text,
            recognizedText: typeof recognizedText === 'string' ? recognizedText : null,
            sentenceId,
            duration: admitted.duration,
            source,
            metadata: admitted.metadata,
        });

        console.log(
            `[Upload] Persisted recordingId=${result.recordingId ?? 'null'} contributionId=${result.contributionId ?? 'null'} reusedContribution=${result.reusedContribution} manifestAlreadySynced=${result.manifestAlreadySynced} transcriptAlreadySynced=${result.transcriptAlreadySynced ?? 'n/a'}`,
        );

        res.json({
            success: true,
            contributionId: result.contributionId,
            recordingId: result.recordingId,
            manifestPath: result.manifestPath,
            reusedContribution: result.reusedContribution,
            manifestAlreadySynced: result.manifestAlreadySynced,
            transcriptAlreadySynced: result.transcriptAlreadySynced,
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        const status = error instanceof UploadAdmissionError ? error.status : 500;
        console.error('[Upload] Complete error:', message);
        res.status(status).json({ error: message });
    }
});

/**
 * DELETE /api/upload/contribution
 * Remove one training recording from DB/OSS training material.
 */
router.delete('/contribution', async (req, res) => {
    try {
        const {
            contributionId,
            audioPath,
            recordingId,
        } = req.body as {
            contributionId?: unknown;
            audioPath?: unknown;
            recordingId?: unknown;
        };
        const contributorId = req.user?.id;

        if (!contributorId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (
            typeof contributionId !== 'string' &&
            typeof audioPath !== 'string' &&
            typeof recordingId !== 'string'
        ) {
            return res.status(400).json({ error: 'Missing contributionId, audioPath, or recordingId' });
        }
        if (typeof audioPath === 'string' && !uploadPathBelongsToContributor(audioPath, contributorId)) {
            return res.status(403).json({ error: 'Upload path does not belong to authenticated user' });
        }

        const result = await uploadArtifactService.discardCompletedUpload({
            contributorId,
            contributionId: typeof contributionId === 'string' ? contributionId : null,
            audioPath: typeof audioPath === 'string' ? audioPath : null,
            recordingId: typeof recordingId === 'string' ? recordingId : null,
        });

        console.log(
            `[Upload] Discarded recordingId=${result.recordingId ?? 'null'} contributionId=${result.contributionId ?? 'null'}`,
        );

        res.json({
            success: true,
            ...result,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        console.error('[Upload] Discard error:', message);
        res.status(500).json({ error: message });
    }
});

export const uploadRouter = router;
