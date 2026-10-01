/** End-to-end assertions cover real HTTP/cookies/SQLite; only WhatsApp events are synthetic. */
import { test, expect } from '@playwright/test';
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
  await page.getByLabel('Admin password').fill(password);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Bot overview' })).toBeVisible();
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

  await page.getByRole('button', { name: 'Connect WhatsApp' }).click();
  await expect(page.getByRole('img', { name: /Scan this QR/ })).toBeVisible();
  await simulate({ action: 'pair' });
  await expect(page.getByRole('heading', { name: 'You’re connected' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Scan this QR/ })).toHaveCount(0);
  if (!process.env.BOT_WORKER_DIR) {
    await expect(page.getByRole('heading', { name: 'Ramesh’s inbox' })).toBeVisible();
    await page.getByRole('button', { name: /Site visits/ }).click();
    await expect(
      page.getByText('The site visit is tomorrow at 10.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.message-bubble').getByText('Alice', { exact: true })).toBeVisible();
    await page.getByLabel('Tagged only').check();
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
    await page.getByLabel('Tagged only').uncheck();
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
    await page.getByLabel('Message as Ramesh').fill('I will join the visit.');
    await page.getByRole('button', { name: 'Send as Ramesh', exact: true }).click();
    await expect(page.getByLabel('Message as Ramesh')).toHaveValue('');
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
    await page.getByLabel('Message as Ramesh').fill('Accepted despite a lost response.');
    await page.getByRole('button', { name: 'Send as Ramesh', exact: true }).click();
    await expect(
      page
        .locator('.message-bubble.outbound')
        .getByText('Accepted despite a lost response.', { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByLabel('Message as Ramesh')).toHaveValue('');
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '/tmp/ramesh-inbox-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: 'Groups', exact: true }).click();
    await page.getByRole('button', { name: /Site visits/ }).click();
    await page.screenshot({ path: '/tmp/ramesh-inbox-desktop.png', fullPage: true });
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
    await page.getByLabel('Message as Ramesh').fill('Draft while disconnected');
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
