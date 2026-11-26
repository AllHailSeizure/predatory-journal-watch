import { Hono } from 'hono';
import type {
  OnCommentCreateRequest,
  OnPostSubmitRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { runOnComment, runOnPost } from './predatory-journal-watch';

export function createApp(): Hono {
  const app = new Hono();

  // Each handler catches its own errors; triggers always acknowledge.
  app.post('/internal/triggers/post-submit', async (c) => {
    await runOnPost(await c.req.json<OnPostSubmitRequest>());
    return c.json<TriggerResponse>({ status: 'ok' });
  });

  app.post('/internal/triggers/comment-create', async (c) => {
    await runOnComment(await c.req.json<OnCommentCreateRequest>());
    return c.json<TriggerResponse>({ status: 'ok' });
  });

  return app;
}
