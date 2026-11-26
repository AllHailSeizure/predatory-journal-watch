import { describe, expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import { createApp } from './app';
import {
  createModTest,
  expectAllEndpointsCovered,
  type FakeHttp,
  type HttpCall,
} from './test-harness';

const SUPABASE = 'eimdgqymjwfljtapnuyl.supabase.co';
const APP_USER = 'test-app';

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
const DEFAULT_ALLOWLIST = 'mdpi.com\nfrontiersin.org\nMDPI\nFrontiers';

/**
 * Fakes the Supabase project: the resolve-doi edge function and the bot_logs
 * table the logger writes to. Returns the resolve-doi calls.
 */
function supabase(http: FakeHttp, resolve: (call: HttpCall) => Response): () => HttpCall[] {
  http.stub(SUPABASE, () => new Response(null, { status: 201 }), { path: '/rest/v1/bot_logs' });
  http.stub(SUPABASE, resolve, { path: '/functions/v1/resolve-doi', method: 'POST' });
  return () => http.callsTo(SUPABASE).filter((c) => c.path === '/functions/v1/resolve-doi');
}
const found =
  (...hits: Hit[]) =>
  () =>
    Response.json({ hits, watchlistCount: 1200 });
const none = () => Response.json({ hits: [], watchlistCount: 1200 });

const test = createModTest({
  appFactory: createApp,
  settings: {
    supabaseUrl: `https://${SUPABASE}`,
    supabaseFunctionToken: 'fn-token',
    supabaseServiceKey: 'service-key',
    botSignature: 'I am a bot.',
  },
});

const WARNING =
  'Note that Hijack Journal appears on [Hijacked Journal Checker](https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/) as a possible [predatory journal](https://en.wikipedia.org/wiki/Predatory_publishing).' +
  '\n\n---\n\n^I ^am ^a ^bot.';

describe('predatory-journal-watch: posts', () => {
  test('warns once on a post that links a watchlisted domain', async ({
    world,
    runner,
    http,
    events,
  }) => {
    const calls = supabase(http, found(HIJACK));

    const post = await runner.userPosts('alice', {
      id: 't3_p1',
      title: 'A paper',
      selftext: 'Published at https://www.hijack.example/vol1/a.pdf and doi:10.1234/abc.5',
      url: '', // see the permalink test below
    });

    expect(calls()).toHaveLength(1);
    expect(calls()[0]?.headers.authorization).toBe('Bearer fn-token');
    expect(calls()[0]?.json).toEqual({
      hosts: ['hijack.example'], // normalized: www. stripped
      dois: ['10.1234/abc.5'],
      allowlist: DEFAULT_ALLOWLIST, // devvit.json default
      matchPublisherName: false,
    });
    const [warning] = world.commentsOn(post.id);
    expect(warning?.body).toBe(WARNING);
    expect(world.describeActions()).toEqual([
      expect.stringMatching(
        new RegExp(`^test-app comment t3_p1 id=${warning?.id} "Note that Hijack Journal`)
      ),
      `test-app distinguish ${warning?.id} sticky=true`,
      `test-app lock ${warning?.id}`,
    ]);
    expect(await redis.get(`bot:pjmod:handled:${post.id}`)).toBe('1');
    expect(await redis.get(`bot:pjmod:pub:${post.id}:hijack.example`)).toBe('1');
    expect(await redis.zCard('bot:pjmod:log')).toBe(1);

    // Redelivery of the same trigger does nothing.
    await runner.trigger('post-submit', events.postSubmit(post.id));
    expect(world.commentsOn(post.id)).toHaveLength(1);
    expect(calls()).toHaveLength(1);
  });

  test('skips posts with no links or DOIs without calling Supabase', async ({ runner, http }) => {
    const calls = supabase(http, found(HIJACK));
    const post = await runner.userPosts('alice', {
      title: 'A paper',
      selftext: 'Just words.',
      url: '',
    });

    expect(calls()).toHaveLength(0);
    expect(await redis.get(`bot:pjmod:handled:${post.id}`)).toBe('1');
  });

  test('a self post also sends its reddit.com permalink host (one extra resolve-doi call)', async ({
    runner,
    http,
  }) => {
    // Reddit reports a self post's url as its own permalink, and runOnPost scans post.url,
    // so a self post with no links still calls resolve-doi with hosts ['reddit.com'].
    const calls = supabase(http, none);
    await runner.userPosts('alice', { title: 'A paper', selftext: 'Just words.' });

    expect(calls()[0]?.json).toMatchObject({ hosts: ['reddit.com'], dois: [] });
  });

  test('marks posts with no watchlist hits as handled without commenting', async ({
    world,
    runner,
    http,
  }) => {
    supabase(http, none);
    const post = await runner.userPosts('alice', {
      title: 'A paper',
      selftext: 'https://arxiv.org/abs/1',
    });

    expect(world.actions).toEqual([]);
    expect(await redis.get(`bot:pjmod:handled:${post.id}`)).toBe('1');
  });

  test('does nothing when disabled', async ({ world, runner, http, configure }) => {
    const calls = supabase(http, found(HIJACK));
    configure({ predatoryWatchEnabled: false });
    await runner.userPosts('alice', { title: 'A paper', selftext: 'https://hijack.example/x' });

    expect(calls()).toHaveLength(0);
    expect(world.actions).toEqual([]);
  });

  test('ignores content written by the app account itself', async ({ runner, http }) => {
    const calls = supabase(http, found(HIJACK));
    const post = await runner.userPosts(APP_USER.toUpperCase(), {
      title: 'x',
      selftext: 'https://hijack.example/x',
    });

    expect(calls()).toHaveLength(0);
    expect(await redis.get(`bot:pjmod:handled:${post.id}`)).toBe('1');
  });

  test('tolerates a trailing slash on supabaseUrl for resolve-doi', async ({
    runner,
    http,
    configure,
  }) => {
    // Known gap: helpers/logger.ts does not strip it, so bot_logs goes to `//rest/v1/bot_logs`.
    http.stub(SUPABASE, () => new Response(null, { status: 201 }), { path: '//rest/v1/bot_logs' });
    const calls = supabase(http, none);
    configure({ supabaseUrl: `https://${SUPABASE}/` });
    await runner.userPosts('alice', { title: 'x', selftext: 'https://x.example/' });

    expect(calls()).toHaveLength(1);
  });

  test('falls back to the service key bearer when no function token is set', async ({
    runner,
    http,
    configure,
  }) => {
    const calls = supabase(http, none);
    configure({ supabaseFunctionToken: '' });
    await runner.userPosts('alice', { title: 'x', selftext: 'https://x.example/' });

    expect(calls()[0]?.headers.authorization).toBe('Bearer service-key');
  });

  test('leaves content unhandled (retryable) when Supabase is not configured', async ({
    runner,
    http,
    configure,
  }) => {
    configure({ supabaseUrl: '' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const post = await runner.userPosts('alice', {
      title: 'x',
      selftext: 'https://hijack.example/x',
    });

    expect(http.calls).toHaveLength(0);
    expect(await redis.get(`bot:pjmod:handled:${post.id}`)).toBeUndefined();
  });

  test('leaves content unhandled when the watchlist is empty or resolve-doi fails', async ({
    world,
    runner,
    http,
  }) => {
    let mode: 'empty' | 'error' = 'empty';
    supabase(http, () =>
      mode === 'empty'
        ? Response.json({ hits: [HIJACK], watchlistCount: 0 })
        : new Response('boom', { status: 500 })
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const empty = await runner.userPosts('alice', {
      title: 'x',
      selftext: 'https://hijack.example/x',
    });
    mode = 'error';
    const err = await runner.userPosts('alice', {
      title: 'y',
      selftext: 'https://hijack.example/x',
    });

    expect(world.actions).toEqual([]);
    expect(await redis.get(`bot:pjmod:handled:${empty.id}`)).toBeUndefined();
    expect(await redis.get(`bot:pjmod:handled:${err.id}`)).toBeUndefined();
  });

  test('releases its claims when posting the warning fails', async ({
    world,
    runner,
    http,
    events,
  }) => {
    supabase(http, found(HIJACK));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const getPost = reddit.getPostById;
    vi.mocked(reddit.getPostById).mockImplementationOnce(
      async (id: T3) =>
        ({
          ...(await getPost(id)),
          addComment: async () => {
            throw new Error('rate limited');
          },
        }) as unknown as Awaited<ReturnType<typeof reddit.getPostById>>
    );

    const post = await runner.userPosts('alice', {
      title: 'x',
      selftext: 'https://hijack.example/x',
    });
    expect(await redis.get(`bot:pjmod:handled:${post.id}`)).toBeUndefined();
    expect(await redis.get(`bot:pjmod:pub:${post.id}:hijack.example`)).toBeUndefined();

    await runner.trigger('post-submit', events.postSubmit(post.id));
    expect(world.commentsOn(post.id)).toHaveLength(1);
  });
});

describe('predatory-journal-watch: comments', () => {
  test('replies to a comment, without stickying, and never re-warns that publisher on the post', async ({
    world,
    runner,
    http,
  }) => {
    supabase(http, found(HIJACK));
    const post = world.seedPost({ id: 't3_thread', title: 'Discussion', author: 'op' });

    const c1 = await runner.userComments('bob', post.id, 'see https://hijack.example/a');
    const c2 = await runner.userComments('carol', c1.id, 'also https://hijack.example/b');

    const [reply] = world.commentsOn(c1.id);
    expect(reply?.body).toContain('Hijack Journal');
    expect(reply).toMatchObject({ distinguished: true, stickied: false, locked: true });
    expect(world.commentsOn(c2.id)).toHaveLength(0);
  });

  test('skips comments when comment checking is off', async ({
    world,
    runner,
    http,
    configure,
  }) => {
    const calls = supabase(http, found(HIJACK));
    configure({ predatoryWatchCheckComments: false });
    const post = world.seedPost({ title: 'x' });
    await runner.userComments('bob', post.id, 'https://hijack.example/a');

    expect(calls()).toHaveLength(0);
  });

  test('passes the allowlist and publisher-name setting through to resolve-doi', async ({
    world,
    runner,
    http,
    configure,
  }) => {
    const calls = supabase(http, none);
    configure({ predatoryWatchAllowlist: 'mdpi.com', predatoryWatchMatchPublisherName: true });
    const post = world.seedPost({ title: 'x' });
    await runner.userComments('bob', post.id, 'https://www.mdpi.com/1');

    expect(calls()[0]?.json).toMatchObject({ allowlist: 'mdpi.com', matchPublisherName: true });
  });

  test('a scenario: hijacked link in a post, then the same publisher in a comment', async ({
    runner,
    http,
  }) => {
    supabase(http, found(HIJACK));
    await runner
      .scenario('one warning per publisher per post')
      .when('alice posts a hijacked journal link', ({ runner: r }) =>
        r.userPosts('alice', { id: 't3_s', title: 'paper', selftext: 'https://hijack.example/p' })
      )
      .and('bob links the same publisher in a comment', ({ runner: r }) =>
        r.userComments('bob', 't3_s', 'mirror: https://hijack.example/q')
      )
      .then('only the post got a warning', ({ world, actions }) => {
        expect(actions.filter((a) => a.type === 'comment').map((a) => a.target)).toEqual(['t3_s']);
        expect(world.appComments()).toHaveLength(1);
      })
      .run();
  });

  // Keep last.
  test('every devvit.json endpoint has a scenario', () => {
    expectAllEndpointsCovered();
  });
});
