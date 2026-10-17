// Two-way sync with the Mac server. Pushes the outbox, pulls everything newer than the last position,
// and repeats until both sides are caught up. The outbox is only cleared after the Mac confirms.
// Pure logic: the network call and the storage are passed in, so tests can run it in Node.

const BATCH = 500;

/**
 * @param {object} o
 * @param {Awaited<ReturnType<import('./repo.js').openRepo>>} o.repo
 * @param {(path: string, body: object) => Promise<{status: number, json: any}>} o.post  calls the Mac with the device token
 * @param {(status: object) => void} [o.onStatus]
 * @param {() => number} [o.now]
 */
export async function syncOnce({ repo, post, onStatus = () => {}, now = () => Date.now() }) {
  let rounds = 0;
  let pulled = 0;
  let pushed = 0;
  for (;;) {
    if (++rounds > 200) throw new Error('sync did not settle');
    const outbox = (await repo.outbox()).slice(0, BATCH);
    const epoch = await repo.getMeta('epoch');
    const since = (await repo.getMeta('lastSeq')) ?? 0;

    let res;
    try {
      res = await post('/api/sync', { since, epoch, changes: outbox.map((o) => o.rec) });
    } catch (e) {
      onStatus({ reachable: false, error: 'Mac unreachable' });
      return { ok: false, reason: 'unreachable' };
    }
    if (res.status === 401) {
      onStatus({ reachable: true, error: 'This device is no longer paired' });
      return { ok: false, reason: 'unpaired' };
    }
    if (res.status !== 200) {
      onStatus({ reachable: true, error: `Mac answered ${res.status}` });
      return { ok: false, reason: `http ${res.status}` };
    }

    const body = res.json;
    if (epoch && body.epoch !== epoch) {
      // The Mac's database is new. Send it everything this device holds, then pull from the start.
      await repo.requeueAll();
      await repo.setMeta('epoch', body.epoch);
      await repo.setMeta('lastSeq', 0);
      continue;
    }
    await repo.applyRemote(body.records);
    await repo.ack(outbox.map((o) => o.key));
    if (body.rejected?.length) await repo.setMeta('lastRejected', { at: now(), items: body.rejected });
    await repo.setMeta('epoch', body.epoch);
    await repo.setMeta('lastSeq', body.seq);
    pushed += outbox.length;
    pulled += body.records.length;

    const left = await repo.pendingCount();
    if (!body.more && left === 0) {
      await repo.setMeta('lastSyncAt', now());
      onStatus({ reachable: true, error: null, lastAt: now(), pending: 0 });
      return { ok: true, pushed, pulled };
    }
  }
}
