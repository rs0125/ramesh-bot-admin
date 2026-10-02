/** End-to-end assertions cover real HTTP/cookies/SQLite; only WhatsApp events are synthetic. */
import { test, expect } from '@playwright/test';
import { adversarialFlows } from './adversarial-flows';
test.describe.configure({ mode: 'serial' });

const origin = 'http://127.0.0.1:4310';
const headers = { Authorization: 'Bearer isolated-e2e-control' };
const workerHeaders = { Authorization: 'Bearer isolated-e2e-worker-token-not-a-real-secret' };
const password = 'isolated-e2e-admin-password';
const message = (id: string, group = false, mentioned = false) => ({
  key: {
    id,
    remoteJid: group ? '123456@g.us' : '20000000000@s.whatsapp.net',
    ...(group ? { participant: '20000000000@s.whatsapp.net' } : {}),
  },
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: {
    extendedTextMessage: {
      text: 'hello bot',
      contextInfo: { mentionedJid: mentioned ? ['10000000001@lid'] : [] },
    },
  },
});

test('admin, greeting policy, persisted state, outages, and session revocation work together', async ({
  page,
  request,
  context,
}) => {
  const supervisor = async (action: string) =>
    expect((await request.post(`http://127.0.0.1:4313/${action}`, { headers })).ok()).toBeTruthy();
  const simulate = async (data: Record<string, unknown>) =>
    expect((await request.post('http://127.0.0.1:4312', { headers, data })).ok()).toBeTruthy();
  const status = async () =>
    (await request.get('http://127.0.0.1:4311/v1/status', { headers: workerHeaders })).json();
  const outbound = async () =>
    (await request.get('http://127.0.0.1:4313/outbound', { headers })).json();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  expect((await request.get('/api/bot/status')).status()).toBe(401);
  expect((await request.get('/api/bot/inbox')).status()).toBe(401);
  expect((await request.post('/api/bot/inbox', { data: {} })).status()).toBe(401);
  expect((await request.get('http://127.0.0.1:4311/v1/status')).status()).toBe(401);
  expect(
    (
      await request.post('/api/session', {
        data: { password },
        headers: { Origin: 'https://attacker.invalid' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/session', {
        data: { password: 'x'.repeat(3000) },
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(413);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    animations: 'disabled',
    path: '/tmp/ramesh-login-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    animations: 'disabled',
    path: '/tmp/ramesh-login-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Admin password').fill(password);
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Admin password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(page.getByLabel('Admin password')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: '/tmp/ramesh-overview-desktop.png',
    fullPage: true,
  });
  const cookie = (await context.cookies()).find((item) => item.name === 'wog_bot_admin')!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Strict');
  const response = await page.request.get('/api/bot/status');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.text()).not.toContain(workerHeaders.Authorization);
  expect(
    (
      await page.request.post('/api/bot/control', {
        data: { action: 'connect' },
        headers: { Origin: 'https://attacker.invalid' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/bot/control', {
        data: { action: 'send-anything' },
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(400);

  await page.getByRole('link', { name: 'Connection', exact: true }).click();
  await expect(page).toHaveURL(/#connection$/);
  await expect(page.getByRole('link', { name: 'Connection', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await page.getByRole('button', { name: 'Connect WhatsApp' }).click();
  await expect(page.getByRole('img', { name: /Scan this QR/ })).toBeVisible();
  await page
    .locator('.connection-panel')
    .screenshot({ animations: 'disabled', path: '/tmp/ramesh-pairing.png' });
  await simulate({ action: 'pair' });
  await expect(page.getByRole('heading', { name: 'WhatsApp is connected' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Scan this QR/ })).toHaveCount(0);
  if (!process.env.BOT_WORKER_DIR) {
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await page.getByRole('button', { name: /Site visits/ }).click();
    await expect(
      page.getByText('The site visit is tomorrow at 10.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.message-bubble').getByText('Alice', { exact: true })).toBeVisible();
    await page.getByLabel('Mentions of Ramesh').check();
    await expect(
      page
        .locator('.message-bubble')
        .getByText('The site visit is tomorrow at 10.', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .locator('.message-bubble')
        .getByText('@Ramesh can you confirm the visit?', { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Mentions of Ramesh').uncheck();
    const sendBody = {
      chatId: '123456@g.us',
      text: 'Hello',
      requestId: '44444444-4444-4444-8444-444444444444',
    };
    expect(
      (
        await page.request.post('/api/bot/inbox', {
          data: sendBody,
          headers: { Origin: 'https://attacker.invalid' },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post('/api/bot/inbox', {
          data: { ...sendBody, text: ' ' },
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post('/api/bot/inbox', {
          data: { ...sendBody, chatId: 'unknown@lid' },
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(404);
    await page.getByLabel('Mentions of Ramesh').check();
    await page.getByLabel('Message', { exact: true }).fill('I will join the visit.');
    await page.getByLabel('Message', { exact: true }).press('Control+Enter');
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Mentions of Ramesh')).not.toBeChecked();
    await expect(
      page.locator('.message-bubble.outbound').getByText('I will join the visit.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.message-bubble.outbound').getByText('Sent to WhatsApp', { exact: true }),
    ).toBeVisible();
    // Lose an accepted POST response: polling reconciles the same stored request instead of resending.
    let interrupted = false;
    await page.route('**/api/bot/inbox', async (route) => {
      if (route.request().method() !== 'POST' || interrupted) {
        await route.continue();
        return;
      }
      interrupted = true;
      expect((await route.fetch()).status()).toBe(202);
      await route.abort('failed');
    });
    await page.getByLabel('Message', { exact: true }).fill('Accepted despite a lost response.');
    await page.getByRole('button', { name: 'Send as Ramesh', exact: true }).click();
    await expect(
      page
        .locator('.message-bubble.outbound')
        .getByText('Accepted despite a lost response.', { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await page.unroute('**/api/bot/inbox');
    await page.reload();
    await page.getByRole('button', { name: /Site visits/ }).click();
    await expect(
      page.locator('.message-bubble.outbound').getByText('I will join the visit.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Direct', exact: true }).click();
    await page.getByRole('button', { name: /Kavya/ }).click();
    await expect(
      page.locator('.message-list').getByText('Can we arrange a call?', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.message-list').getByText('I will join the visit.', { exact: true }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Message', { exact: true }).fill('A draft to come back to.');
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await expect(page.getByRole('button', { name: /Kavya/ })).toBeFocused();
    await page.getByLabel('Search conversations').fill('No such conversation');
    await expect(page.getByText('No matches', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByLabel('Search conversations')).toHaveValue('');
    await page.getByRole('button', { name: /Kavya/ }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'A draft to come back to.',
    );
    await page.route('**/api/bot/status', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({
        response,
        json: { ...data, metrics: { ...data.metrics, received: 123456789 } },
      });
    });
    await expect(page.locator('.metric > strong').first()).toHaveAttribute(
      'aria-label',
      '123,456,789',
    );
    for (const width of [320, 768, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await page
          .locator('.metric')
          .first()
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await page.unroute('**/api/bot/status');
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await page.getByRole('button', { name: 'Groups', exact: true }).click();
    await page.getByRole('button', { name: /Site visits/ }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await page.getByRole('button', { name: 'Direct', exact: true }).click();
    await page.getByRole('button', { name: /Kavya/ }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'A draft to come back to.',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      animations: 'disabled',
      path: '/tmp/ramesh-inbox-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: 'Groups', exact: true }).click();
    await page.getByRole('button', { name: /Site visits/ }).click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      animations: 'disabled',
      path: '/tmp/ramesh-inbox-desktop.png',
      fullPage: true,
    });
  }
  if (process.env.BOT_WORKER_DIR) {
    const dm = message('dm-1');
    const mentioned = message('mention-1', true, true);
    await simulate({
      action: 'messages',
      messages: [
        dm,
        dm,
        message('group-ignored', true),
        mentioned,
        { ...message('old'), messageTimestamp: Math.floor(Date.now() / 1000) - 3600 },
        { ...message('own'), key: { ...dm.key, id: 'own', fromMe: true } },
        { ...message('reaction'), message: { reactionMessage: { text: '👍', key: dm.key } } },
      ],
    });
    await expect.poll(async () => (await status()).metrics.replied).toBe(2);
    expect(await outbound()).toEqual([
      { chatId: '20000000000@s.whatsapp.net', id: 'dm-1', text: 'hello' },
      { chatId: '123456@g.us', id: 'mention-1', text: 'hello' },
    ]);
    await simulate({ action: 'messages', type: 'append', messages: [message('history')] });
    await supervisor('restart-worker');
    await expect.poll(async () => (await status()).state).toBe('connected');
    await simulate({ action: 'messages', messages: [dm, mentioned, message('new-after-restart')] });
    await expect.poll(async () => (await status()).metrics.duplicates).toBe(2);
    await expect.poll(async () => (await outbound()).length).toBe(3);

    const uncertain = message('uncertain');
    await simulate({ action: 'messages', uncertainSend: true, messages: [uncertain] });
    await expect.poll(async () => (await status()).metrics.errors).toBe(1);
    await simulate({ action: 'messages', messages: [uncertain] });
    await expect.poll(async () => (await status()).metrics.duplicates).toBe(3);
    expect((await outbound()).length).toBe(4);
  }

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect WhatsApp' })).toBeEnabled();
  if (!process.env.BOT_WORKER_DIR) {
    await page.getByLabel('Message', { exact: true }).fill('Draft while disconnected');
    await expect(page.getByRole('button', { name: 'Send as Ramesh', exact: true })).toBeDisabled();
  }
  await supervisor('restart-worker');
  expect((await status()).state).toBe('stopped');
  await supervisor('stop-worker');
  await expect(page.locator('.error-banner[role="alert"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect WhatsApp' })).toBeDisabled();
  await expect(page.getByRole('img', { name: /Scan this QR/ })).toHaveCount(0);
  await supervisor('start-worker');
  await expect(page.getByRole('button', { name: 'Connect WhatsApp' })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Sign out/ }).click();
  if (!process.env.BOT_WORKER_DIR) {
    const dialog = page.getByRole('dialog', { name: 'Discard drafts and sign out?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep drafts' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Draft while disconnected',
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await dialog.getByRole('button', { name: 'Discard drafts and sign out' }).click();
  }
  await expect(page).toHaveURL(/\/login$/);
  expect(
    (
      await request.get('/api/bot/status', {
        headers: { Cookie: `${cookie.name}=${cookie.value}` },
      })
    ).status(),
  ).toBe(401);
  expect(errors).toEqual([]);
});

test('reading position, focus navigation, recovery, and drafts survive normal operator workflows', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const group = '123456@g.us';
  const started = Date.now() - 3600_000;
  const history = Array.from({ length: 40 }, (_, index) => ({
    id: `ux-message-${index}`,
    chatId: group,
    text: `Site update ${index + 1}: the team is reviewing the warehouse access and loading area.`,
    senderId: 'alice@lid',
    senderName: 'Alice',
    direction: 'inbound',
    source: 'whatsapp',
    mentionsBot: index % 5 === 0,
    at: new Date(started + index * 1000).toISOString(),
    status: 'RECEIVED',
    kind: 'text',
  }));
  let messagesUnavailable = true;
  let statusUnavailable = false;
  let conversationsPaged = false;
  const status = {
    state: 'connected',
    qr: null,
    updatedAt: new Date(started).toISOString(),
    startedAt: new Date(started).toISOString(),
    metrics: { received: 40, replied: 0, duplicates: 0, errors: 0, dropped: 0 },
    events: [],
  };
  await page.route('**/api/bot/status', (route) =>
    route.fulfill(
      statusUnavailable
        ? {
            status: 503,
            json: { error: 'Status service temporarily unavailable' },
          }
        : { json: status },
    ),
  );
  await page.route('**/api/bot/control', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'The connection change could not be confirmed.' },
    }),
  );
  await page.route('**/api/bot/inbox**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('chatId')) {
      await route.fulfill(
        messagesUnavailable
          ? { status: 503, json: { error: 'History temporarily unavailable' } }
          : { json: { messages: history, nextCursor: null } },
      );
    } else {
      if (url.searchParams.has('cursor')) conversationsPaged = true;
      await route.fulfill({
        json: {
          conversations: [
            {
              chatId: group,
              name: 'Site visits',
              isGroup: true,
              lastMessage: history.at(-1)!.text,
              lastMessageAt: history.at(-1)!.at,
            },
          ],
          nextCursor: conversationsPaged ? null : 'next-conversations',
          groupRepliesRequireMention: true,
        },
      });
    }
  });
  await page.goto('/login');
  await page.getByLabel('Admin password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Search covers 1 loaded conversation.')).toBeVisible();
  await page.getByLabel('Search conversations').fill('Unloaded contact');
  await expect(
    page.getByText('No matches in loaded conversations', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load more conversations', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Load more conversations', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: /Site visits/ }).click();
  await expect(page.getByText('Messages could not be loaded. Try again above.')).toBeVisible();
  await expect(page.getByText('Loading messages…', { exact: true })).toHaveCount(0);
  messagesUnavailable = false;
  await page.locator('.conversation-thread').getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.message-bubble')).toHaveCount(40);

  const messages = page.getByRole('log', { name: 'Messages' });
  const nextPoll = page.waitForResponse((response) =>
    new URL(response.url()).searchParams.has('chatId'),
  );
  const readingPosition = await messages.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 24;
    return element.scrollTop;
  });
  await (await nextPoll).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await messages.evaluate((element) => element.scrollTop)).toBeCloseTo(readingPosition, 0);

  await messages.evaluate((element) => {
    element.scrollTop = 200;
  });
  await expect(page.getByRole('button', { name: 'Jump to latest', exact: true })).toBeVisible();
  history.push({
    ...history[0]!,
    id: 'ux-new-message',
    text: 'A new update arrived while you were reading.',
    at: new Date().toISOString(),
  });
  await page.getByRole('button', { name: '1 new message · Jump to latest', exact: true }).waitFor();
  expect(await messages.evaluate((element) => element.scrollTop)).toBeCloseTo(200, 0);
  await page.getByRole('button', { name: '1 new message · Jump to latest', exact: true }).click();
  await expect(page.getByRole('button', { name: /Jump to latest/ })).toHaveCount(0);
  expect(
    await messages.evaluate(
      (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
    ),
  ).toBeLessThan(2);

  await page.getByLabel('Message', { exact: true }).fill('Keep this draft through focus changes.');
  await page.getByRole('button', { name: 'Expand inbox', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).not.toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this draft through focus changes.',
  );
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const target = await page
      .getByRole('button', { name: 'Send as Ramesh', exact: true })
      .boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(44);
    const footer = await page.locator('.inbox-footnote').boundingBox();
    expect(target!.y + target!.height).toBeLessThanOrEqual(footer!.y);
    const composer = await page.locator('.message-composer').boundingBox();
    const readingArea = await messages.boundingBox();
    expect(readingArea!.y + readingArea!.height).toBeLessThanOrEqual(composer!.y + 1);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Keep this draft through focus changes.',
    );
  }
  await page.getByRole('link', { name: 'Connection', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'WhatsApp connection', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand inbox', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connection', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );

  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  const actionError = page.locator('.action-feedback');
  await expect(actionError).toBeVisible();
  await (await page.waitForResponse('**/api/bot/status')).finished();
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeEnabled();
  await expect(actionError).toBeVisible();
  await expect(actionError).not.toContainText('Retrying automatically');
  await page.getByRole('button', { name: 'Dismiss action error' }).click();
  await expect(actionError).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand inbox', exact: true }).click();
  statusUnavailable = true;
  await expect(
    page.getByText('Connection status is unavailable. You can still write a draft.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send as Ramesh', exact: true })).toBeDisabled();
  await page.locator('.message-composer').getByRole('link', { name: 'Manage connection' }).click();
  await expect(page.getByRole('button', { name: 'Expand inbox', exact: true })).toBeVisible();
  statusUnavailable = false;
  await expect(page.getByRole('button', { name: 'Send as Ramesh', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Expand inbox', exact: true }).click();
  await page.screenshot({
    animations: 'disabled',
    path: '/tmp/ramesh-ux-focus-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    animations: 'disabled',
    path: '/tmp/ramesh-ux-focus-mobile.png',
    fullPage: true,
  });

  const departure = page.waitForEvent('dialog');
  const navigation = page.goto('/login').catch(() => null);
  const prompt = await departure;
  expect(prompt.type()).toBe('beforeunload');
  await prompt.dismiss();
  await navigation;
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this draft through focus changes.',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard drafts and sign out?' });
  await expect(dialog.getByRole('button', { name: 'Keep drafts' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Discard drafts and sign out' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Keep drafts' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Discard drafts and sign out' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep drafts' }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
  await page.getByLabel('Message', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

adversarialFlows();

test('login limits survive admin restarts and untrusted forwarding headers', async ({
  request,
}) => {
  // The earlier successful sign-in counts too; exhaust the same persisted local bucket.
  let limited = false;
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await request.post('/api/session', {
      data: { password: 'wrong' },
      headers: { Origin: origin, 'X-Forwarded-For': `198.51.100.${attempt}` },
    });
    if (response.status() === 429) {
      limited = true;
      expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0);
      break;
    }
    expect(response.status()).toBe(401);
  }
  expect(limited).toBe(true);
  expect(
    (await request.post('http://127.0.0.1:4313/restart-admin', { headers })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post('/api/session', { data: { password }, headers: { Origin: origin } })
    ).status(),
  ).toBe(429);
});
