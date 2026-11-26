import { describe, expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import type { OnCommentCreateRequest, OnPostSubmitRequest, T1, T3 } from '@devvit/web/shared';
import { createApp } from './app';
import { createModTest, type FakeRedditWorld } from './test-harness';

const SUPABASE = 'https://supabase.test';
const APP_USER = 'predatory-journal-watch';

type Hit = {
  publisherKey: string;
  nameKey?: string | null;
  publisher: string;
  sourceList: string;
  sourceUrl: string;
  domain: string;
};

const HIJACK: Hit = {
  publisherKey: 'hijack.example',
  nameKey: null,
  publisher: 'Hijack Journal',
  sourceList: 'Hijacked Journal Checker',
  sourceUrl: 'https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/',
  domain: 'hijack.example',
};

type ResolveCall = { auth: string | null; body: Record<string, unknown> };

/**
 * Fakes the Reddit calls the module needs that `@devvit/test` leaves unimplemented
 * (getAppUser, Post.addComment, Comment.reply) on top of FakeRedditWorld's
 * submitComment spy, and fakes the Supabase resolve-doi edge function via a spied
 * fetch. Nothing reaches Reddit or Supabase.
 */
function install(world: FakeRedditWorld, resolve: (body: Record<string, unknown>) => Response) {
  const calls: ResolveCall[] = [];
  vi.spyOn(reddit, 'getAppUser').mockResolvedValue({ username: APP_USER } as unknown as Awaited<
    ReturnType<typeof reddit.getAppUser>
  >);
  vi.spyOn(reddit, 'getPostById').mockImplementation((async (id: T3) => ({
    id,
    addComment: (opts: { text: string; runAs?: 'APP' }) =>
      reddit.submitComment({ id, text: opts.text, runAs: opts.runAs }),
  })) as unknown as typeof reddit.getPostById);
  vi.spyOn(reddit, 'getCommentById').mockImplementation((async (id: T1) => ({
    id,
    reply: (opts: { text: string; runAs?: 'APP' }) =>
      reddit.submitComment({ id, text: opts.text, runAs: opts.runAs }),
  })) as unknown as typeof reddit.getCommentById);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url !== `${SUPABASE}/functions/v1/resolve-doi`) throw new Error(`unexpected fetch ${url}`);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ auth: headers.Authorization ?? null, body });
    return resolve(body);
  });
  return calls;
}

const found =
  (...hits: Hit[]) =>
  () =>
    Response.json({ hits, watchlistCount: 1200 });
const none = () => Response.json({ hits: [], watchlistCount: 1200 });

const test = createModTest({
  appFactory: createApp,
  settings: {
    supabaseUrl: `${SUPABASE}/`,
    supabaseFunctionToken: 'fn-token',
    supabaseServiceKey: 'service-key',
    botSignature: 'I am a bot.',
  },
});

const postEvent = (id: T3, selftext: string, author = 'alice') =>
  ({
    type: 'PostSubmit',
    post: { id, title: 'A paper', selftext, url: '' },
    author: { id: 't2_alice', name: author },
  }) as unknown as OnPostSubmitRequest;

const commentEvent = (postId: T3, id: T1, body: string, author = 'bob') =>
  ({
    type: 'CommentCreate',
    post: { id: postId },
    comment: { id, postId, body, author },
    author: { id: 't2_bob', name: author },
  }) as unknown as OnCommentCreateRequest;

describe('predatory-journal-watch: posts', () => {
  test('warns once on a post that links a watchlisted domain', async ({ world, runner }) => {
    const calls = install(world, found(HIJACK));
    const postId = 't3_p1' as T3;
    world.seedPost({ id: postId, title: 'A paper' });

    const res = await runner.trigger(
      'post-submit',
      postEvent(postId, 'Published at https://www.hijack.example/vol1/a.pdf and doi:10.1234/abc.5')
    );

    expect(res).toEqual({ status: 'ok' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.auth).toBe('Bearer fn-token');
    expect(calls[0]?.body).toEqual({
      hosts: ['hijack.example'], // normalized: www. stripped
      dois: ['10.1234/abc.5'],
      allowlist: null,
      matchPublisherName: false,
    });
    const [warning] = world.commentsOn(postId);
    expect(warning?.body).toBe(
      'Note that Hijack Journal appears on [Hijacked Journal Checker](https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/) as a possible [predatory journal](https://en.wikipedia.org/wiki/Predatory_publishing).' +
        '\n\n---\n\n^I ^am ^a ^bot.'
    );
    expect(warning?.distinguished).toBe(true);
    expect(warning?.stickied).toBe(true);
    expect(warning?.locked).toBe(true);
    expect(await redis.get(`bot:pjmod:handled:${postId}`)).toBe('1');
    expect(await redis.get(`bot:pjmod:pub:${postId}:hijack.example`)).toBe('1');
    expect(await redis.zCard('bot:pjmod:log')).toBe(1);

    // Redelivery of the same trigger does nothing.
    await runner.trigger('post-submit', postEvent(postId, 'https://www.hijack.example/vol1/a.pdf'));
    expect(world.commentsOn(postId)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test('skips posts with no links or DOIs without calling Supabase', async ({ world, runner }) => {
    const calls = install(world, found(HIJACK));
    await runner.trigger('post-submit', postEvent('t3_plain' as T3, 'Just words.'));

    expect(calls).toHaveLength(0);
    expect(await redis.get('bot:pjmod:handled:t3_plain')).toBe('1');
  });

  test('marks posts with no watchlist hits as handled without commenting', async ({
    world,
    runner,
  }) => {
    install(world, none);
    await runner.trigger('post-submit', postEvent('t3_clean' as T3, 'https://arxiv.org/abs/1'));

    expect(world.commentsOn('t3_clean' as T3)).toHaveLength(0);
    expect(await redis.get('bot:pjmod:handled:t3_clean')).toBe('1');
  });

  test('does nothing when disabled', async ({ world, runner, mocks }) => {
    const calls = install(world, found(HIJACK));
    mocks.settings.update({ predatoryWatchEnabled: false });

    await runner.trigger('post-submit', postEvent('t3_off' as T3, 'https://hijack.example/x'));

    expect(calls).toHaveLength(0);
    expect(world.commentsOn('t3_off' as T3)).toHaveLength(0);
  });

  test('ignores content written by the app account itself', async ({ world, runner }) => {
    const calls = install(world, found(HIJACK));
    await runner.trigger(
      'post-submit',
      postEvent('t3_self' as T3, 'https://hijack.example/x', APP_USER.toUpperCase())
    );

    expect(calls).toHaveLength(0);
    expect(await redis.get('bot:pjmod:handled:t3_self')).toBe('1');
  });

  test('falls back to the service key bearer when no function token is set', async ({
    world,
    runner,
    mocks,
  }) => {
    const calls = install(world, none);
    mocks.settings.update({ supabaseFunctionToken: '' });

    await runner.trigger('post-submit', postEvent('t3_bearer' as T3, 'https://x.example/'));

    expect(calls[0]?.auth).toBe('Bearer service-key');
  });

  test('leaves content unhandled (retryable) when Supabase is not configured', async ({
    world,
    runner,
    mocks,
  }) => {
    const calls = install(world, found(HIJACK));
    mocks.settings.update({ supabaseUrl: '' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runner.trigger('post-submit', postEvent('t3_nocfg' as T3, 'https://hijack.example/x'));

    expect(calls).toHaveLength(0);
    expect(await redis.get('bot:pjmod:handled:t3_nocfg')).toBeUndefined();
  });

  test('leaves content unhandled when the watchlist is empty or resolve-doi fails', async ({
    world,
    runner,
  }) => {
    let mode: 'empty' | 'error' = 'empty';
    install(world, () =>
      mode === 'empty'
        ? Response.json({ hits: [HIJACK], watchlistCount: 0 })
        : new Response('boom', { status: 500 })
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runner.trigger('post-submit', postEvent('t3_empty' as T3, 'https://hijack.example/x'));
    mode = 'error';
    await runner.trigger('post-submit', postEvent('t3_err' as T3, 'https://hijack.example/x'));

    expect(world.commentsOn('t3_empty' as T3)).toHaveLength(0);
    expect(world.commentsOn('t3_err' as T3)).toHaveLength(0);
    expect(await redis.get('bot:pjmod:handled:t3_empty')).toBeUndefined();
    expect(await redis.get('bot:pjmod:handled:t3_err')).toBeUndefined();
  });

  test('releases its claims when posting the warning fails', async ({ world, runner }) => {
    install(world, found(HIJACK));
    vi.mocked(reddit.submitComment).mockRejectedValueOnce(new Error('rate limited'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const postId = 't3_fail' as T3;

    await runner.trigger('post-submit', postEvent(postId, 'https://hijack.example/x'));

    expect(await redis.get(`bot:pjmod:handled:${postId}`)).toBeUndefined();
    expect(await redis.get(`bot:pjmod:pub:${postId}:hijack.example`)).toBeUndefined();

    await runner.trigger('post-submit', postEvent(postId, 'https://hijack.example/x'));
    expect(world.commentsOn(postId)).toHaveLength(1);
  });
});

describe('predatory-journal-watch: comments', () => {
  test('replies to a comment, without stickying, and never re-warns that publisher on the post', async ({
    world,
    runner,
  }) => {
    install(world, found(HIJACK));
    const postId = 't3_thread' as T3;

    await runner.trigger(
      'comment-create',
      commentEvent(postId, 't1_c1' as T1, 'see https://hijack.example/a')
    );
    await runner.trigger(
      'comment-create',
      commentEvent(postId, 't1_c2' as T1, 'also https://hijack.example/b')
    );

    const [reply] = world.commentsOn('t1_c1' as T1);
    expect(reply?.body).toContain('Hijack Journal');
    expect(reply?.distinguished).toBe(true);
    expect(reply?.stickied).toBe(false);
    expect(reply?.locked).toBe(true);
    expect(world.commentsOn('t1_c2' as T1)).toHaveLength(0);
  });

  test('skips comments when comment checking is off', async ({ world, runner, mocks }) => {
    const calls = install(world, found(HIJACK));
    mocks.settings.update({ predatoryWatchCheckComments: false });

    await runner.trigger(
      'comment-create',
      commentEvent('t3_x' as T3, 't1_x' as T1, 'https://hijack.example/a')
    );

    expect(calls).toHaveLength(0);
  });

  test('passes the allowlist and publisher-name setting through to resolve-doi', async ({
    world,
    runner,
    mocks,
  }) => {
    const calls = install(world, none);
    mocks.settings.update({
      predatoryWatchAllowlist: 'mdpi.com',
      predatoryWatchMatchPublisherName: true,
    });

    await runner.trigger(
      'comment-create',
      commentEvent('t3_y' as T3, 't1_y' as T1, 'https://www.mdpi.com/1')
    );

    expect(calls[0]?.body).toMatchObject({ allowlist: 'mdpi.com', matchPublisherName: true });
  });
});
