/** Exercises interrupted operator flows against controlled browser responses, never live WhatsApp. */
import { expect, test } from '@playwright/test';

export function adversarialFlows() {
  test('slow loads, pagination failures, pending sends, and expired sessions preserve the workflow', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const started = Date.now() - 3600_000;
    const conversations = [
      { chatId: 'review-group@g.us', name: 'Warehouse visits', isGroup: true },
      { chatId: 'review-direct@lid', name: 'Kavya', isGroup: false },
    ].map((item) => ({
      ...item,
      lastMessage: 'Please confirm the visit.',
      lastMessageAt: new Date(started).toISOString(),
    }));
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: `review-${index}`,
      chatId: conversations[0]!.chatId,
      text: `Visit update ${index + 1}`,
      senderId: 'review@lid',
      senderName: 'Kavya',
      direction: 'inbound',
      source: 'whatsapp',
      mentionsBot: false,
      at: new Date(started + index * 1000).toISOString(),
      status: 'RECEIVED',
      kind: 'text',
    }));
    let releaseInitial!: () => void;
    const initial = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    let releaseMessages!: () => void;
    const messageGate = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let paginationFails = true;
    let expired = false;
    let sends = 0;
    let signInUnavailable = true;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/session', async (route) => {
      if (route.request().method() === 'POST') {
        if (signInUnavailable)
          await route.fulfill({
            status: 502,
            contentType: 'text/html',
            body: '<h1>Bad gateway</h1>',
          });
        else {
          expired = false;
          await route.fulfill({ json: { ok: true } });
        }
      } else await route.continue();
    });
    // Authenticate once before installing the in-place reauthentication fixture.
    await page.request.post('/api/session', {
      data: { password: 'isolated-e2e-admin-password' },
      headers: { Origin: 'http://127.0.0.1:4310' },
    });
    await page.route('**/api/bot/status', async (route) => {
      await initial;
      await route.fulfill(
        expired
          ? { status: 401, json: { error: 'Unauthorized' } }
          : {
              json: {
                state: 'connected',
                qr: null,
                updatedAt: new Date(started).toISOString(),
                startedAt: new Date(started).toISOString(),
                metrics: { received: 20, replied: 0, duplicates: 0, errors: 0, dropped: 0 },
                events: [],
              },
            },
      );
    });
    await page.route('**/api/bot/inbox**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST') {
        sends++;
        await sendGate;
        const { requestId, text, chatId } = route.request().postDataJSON();
        history.push({
          ...history[0]!,
          id: `${requestId}:reply`,
          text,
          chatId,
          source: 'admin',
          direction: 'outbound',
          status: 'SENT',
          at: new Date().toISOString(),
        });
        await route.fulfill({ status: 202, json: { ok: true } });
        return;
      }
      await initial;
      if (expired) {
        await route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
      } else if (url.searchParams.has('cursor')) {
        await route.fulfill(
          paginationFails
            ? { status: 503, json: { error: 'Older history unavailable' } }
            : {
                json: {
                  messages: [],
                  conversations: [],
                  nextCursor: null,
                  groupRepliesRequireMention: true,
                },
              },
        );
      } else if (url.searchParams.has('chatId')) {
        await messageGate;
        await route.fulfill({
          json: {
            messages: history.filter((item) => item.chatId === url.searchParams.get('chatId')),
            nextCursor: 'older-messages',
          },
        });
      } else {
        await route.fulfill({
          json: { conversations, nextCursor: 'more-chats', groupRepliesRequireMention: true },
        });
      }
    });
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Loading conversations' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading activity' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No recent activity' })).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page
        .locator('.skeleton')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
    await page.screenshot({
      animations: 'disabled',
      path: '/tmp/ramesh-review-loading.png',
      fullPage: true,
    });
    releaseInitial();
    await expect(page.getByRole('button', { name: /Warehouse visits/ })).toBeVisible();
    await page.getByRole('button', { name: 'Load more conversations' }).click();
    const paginationError = page.locator('.conversation-list .pagination-error');
    await expect(paginationError).toBeVisible();
    await (
      await page.waitForResponse((response) => response.url().endsWith('/api/bot/inbox'))
    ).finished();
    await expect(paginationError).toBeVisible();
    paginationFails = false;
    await page.getByRole('button', { name: 'Retry loading conversations' }).click();
    await expect(paginationError).toHaveCount(0);
    await page.getByRole('button', { name: /Warehouse visits/ }).click();
    await expect(page.getByRole('status', { name: 'Loading messages' })).toBeVisible();
    releaseMessages();
    await expect(page.locator('.message-bubble')).toHaveCount(20);
    paginationFails = true;
    await page.getByRole('button', { name: 'Load older messages' }).click();
    const historyError = page.locator('.message-list .pagination-error');
    await expect(historyError).toBeVisible();
    await (
      await page.waitForResponse(
        (response) =>
          new URL(response.url()).searchParams.has('chatId') &&
          !new URL(response.url()).searchParams.has('cursor'),
      )
    ).finished();
    await expect(historyError).toBeVisible();
    paginationFails = false;
    await page.getByRole('button', { name: 'Retry older messages' }).click();
    await expect(historyError).toHaveCount(0);
    await page.getByLabel('Message', { exact: true }).fill('Confirming the warehouse visit.');
    await page.getByRole('button', { name: 'Send as Ramesh' }).click();
    await page.getByRole('button', { name: /Kavya/ }).click();
    await page.getByLabel('Message', { exact: true }).fill('Keep this second draft.');
    await page.getByRole('button', { name: /Warehouse visits/ }).click();
    await expect(page.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(sends).toBe(1);
    releaseSend();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: /Kavya/ }).click();
    await page.getByLabel('Message', { exact: true }).focus();
    expired = true;
    const dialog = page.getByRole('dialog', { name: 'Session expired' });
    await expect(dialog).toBeVisible();
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(dialog.getByLabel('Admin password')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('link', { name: 'Return to sign-in' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Admin password')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Admin password').fill('review-password');
    await dialog.getByRole('button', { name: 'Sign in and continue' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Sign-in is temporarily unavailable. Please try again.',
    );
    await expect(dialog.getByLabel('Admin password')).toHaveAttribute('aria-invalid', 'false');
    await expect(dialog.getByRole('button', { name: 'Sign in and continue' })).toBeEnabled();
    signInUnavailable = false;
    await dialog.getByRole('button', { name: 'Sign in and continue' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Keep this second draft.',
    );
    await expect(page.getByLabel('Message', { exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Send as Ramesh' })).toBeEnabled();
    await page.getByLabel('Message', { exact: true }).fill('');
    expect(errors).toEqual([]);
  });

  test('uncertain sends, late responses, long content, and compact screens remain usable', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const chatId = 'review-long@g.us';
    const otherId = 'review-other@lid';
    const longName =
      'Warehouse operations and site visits — Bangalore, Whitefield, Hoskote, and North Bangalore coordination';
    const started = new Date().toISOString();
    const history: {
      id: string;
      chatId: string;
      text: string;
      direction: string;
      source: string;
      status: string;
      senderName: string;
      senderId: string;
      mentionsBot: boolean;
      at: string;
      kind: string;
    }[] = [];
    let mode: 'unavailable' | 'accept' | 'late-error' = 'unavailable';
    let statusUnavailable = false;
    let releaseLate!: () => void;
    const lateResponse = new Promise<void>((resolve) => {
      releaseLate = resolve;
    });
    const submissions: { requestId: string; text: string }[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    expect(
      (
        await page.request.post('/api/session', {
          data: { password: 'isolated-e2e-admin-password' },
          headers: { Origin: 'http://127.0.0.1:4310' },
        })
      ).ok(),
    ).toBe(true);
    await page.route('**/api/bot/status', (route) =>
      route.fulfill(
        statusUnavailable
          ? { status: 503, json: { error: 'Connection status unavailable' } }
          : {
              json: {
                state: 'connected',
                qr: null,
                updatedAt: started,
                startedAt: started,
                metrics: { received: 0, replied: 0, duplicates: 0, errors: 0, dropped: 0 },
                events: [],
              },
            },
      ),
    );
    await page.route('**/api/bot/inbox**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        submissions.push(body);
        if (mode === 'unavailable') {
          await route.fulfill({
            status: 503,
            contentType: 'text/html',
            body: '<h1>Bad gateway</h1>',
          });
          return;
        }
        history.push({
          ...body,
          id: `${body.requestId}:reply`,
          direction: 'outbound',
          source: 'admin',
          status: 'SENT',
          senderName: 'Ramesh',
          senderId: 'ramesh@lid',
          mentionsBot: false,
          at: new Date().toISOString(),
          kind: 'text',
        });
        if (mode === 'late-error') {
          await lateResponse;
          await route.fulfill({ status: 503, json: { error: 'Late failed response' } });
        } else await route.fulfill({ status: 202, json: { ok: true } });
      } else if (new URL(route.request().url()).searchParams.has('chatId')) {
        await route.fulfill({ json: { messages: history, nextCursor: null } });
      } else
        await route.fulfill({
          json: {
            conversations: [
              {
                chatId,
                name: longName,
                isGroup: true,
                lastMessage: 'A new visit request',
                lastMessageAt: started,
              },
              {
                chatId: otherId,
                name: 'Other contact',
                isGroup: false,
                lastMessage: 'Another visit request',
                lastMessageAt: started,
              },
            ],
            nextCursor: null,
            groupRepliesRequireMention: true,
          },
        });
    });
    await page.goto('/#inbox');
    await page.getByRole('button', { name: new RegExp(longName) }).click();
    await page.getByRole('button', { name: 'Expand inbox', exact: true }).click();
    const draft = page.getByLabel('Message', { exact: true });
    await draft.fill('Please confirm ' + 'long-reference-'.repeat(50));
    await page.getByRole('button', { name: 'Send as Ramesh' }).click();
    await expect(page.getByRole('button', { name: 'Retry sending' })).toBeEnabled();
    await expect(draft).toHaveAttribute('readonly', '');
    await page.getByRole('button', { name: /Other contact/ }).click();
    await page.getByRole('button', { name: new RegExp(longName) }).click();
    await expect(page.locator('.message-composer .error-text')).toContainText(
      'Could not confirm whether the message was sent.',
    );
    await expect(page.locator('#composer-hint')).toContainText(
      'Retry sending to avoid a duplicate.',
    );
    // A cramped viewport, long chat heading, uncertain send, and an outage must not hide recovery controls.
    statusUnavailable = true;
    await expect(page.getByRole('button', { name: 'Retry sending' })).toBeDisabled();
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const composer = await page.locator('.message-composer').boundingBox();
      const footer = await page.locator('.inbox-footnote').boundingBox();
      expect(composer!.y + composer!.height).toBeLessThanOrEqual(footer!.y + 1);
      const readingArea = await page.locator('.thread-scroll-area').boundingBox();
      expect(readingArea!.height).toBeGreaterThanOrEqual(100);
      const manage = page
        .locator('.message-composer')
        .getByRole('link', { name: 'Manage connection' });
      await manage.scrollIntoViewIfNeeded();
      await expect(manage).toBeInViewport();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      animations: 'disabled',
      path: '/tmp/ramesh-review-recovery-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    statusUnavailable = false;
    await expect(page.getByRole('button', { name: 'Retry sending' })).toBeEnabled();
    mode = 'accept';
    await page.getByRole('button', { name: 'Retry sending' }).click();
    await expect(draft).toHaveValue('');
    expect(submissions).toHaveLength(2);
    expect(submissions[0]!.requestId).toBe(submissions[1]!.requestId);
    await expect(page.locator('.message-bubble.outbound')).toHaveCount(1);
    mode = 'late-error';
    await draft.fill('The server accepts this before the HTTP response returns.');
    await page.getByRole('button', { name: 'Send as Ramesh' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Messages submitted' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to inbox' }).click();
    await expect(draft).toHaveValue('');
    await draft.fill('Keep the next draft when the old request fails.');
    const oldResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/bot/inbox'),
    );
    releaseLate();
    await (await oldResponse).finished();
    await expect(draft).toHaveValue('Keep the next draft when the old request fails.');
    await expect(page.locator('.message-composer .error-text')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send as Ramesh' })).toBeEnabled();
    await draft.fill('');
    expect(errors).toEqual([]);
  });

  test('sign-in remains recoverable when the workspace rejects the new session', async ({
    page,
  }) => {
    // Simulate an accepted credential request whose cookie was not retained by the browser/proxy.
    await page.route('**/api/session', (route) => route.fulfill({ json: { ok: true } }));
    await page.goto('/login');
    await page.getByLabel('Admin password').fill('review-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    await expect(page.getByLabel('Admin password')).toBeEditable();
  });
}
