import { TableClient, type TableEntity } from "@azure/data-tables";
import type { AccessTokenInfo, Meeting } from "@cloudpilot/shared";

export interface UsageMonth {
  month: string; // YYYY-MM
  hours: number;
  usd: number;
  lastSampleAt: string | null;
}

/** Persistence used by the control plane. Table Storage in Azure, memory in tests. */
export interface Store {
  listMeetings(): Promise<Meeting[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  putMeeting(m: Meeting): Promise<void>;
  deleteMeeting(id: string): Promise<void>;

  listTokens(): Promise<AccessTokenInfo[]>;
  putToken(t: AccessTokenInfo): Promise<void>;

  getUsage(month: string): Promise<UsageMonth>;
  putUsage(u: UsageMonth): Promise<void>;

  /** Key/value flags (e.g. budget override, last known power state). */
  getFlag(key: string): Promise<string | null>;
  setFlag(key: string, value: string | null): Promise<void>;
}

type Row = TableEntity<{ data: string }>;

export class TableStore implements Store {
  private readonly t: Record<"meetings" | "tokens" | "usage" | "flags", TableClient>;
  private ready: Promise<unknown> | null = null;

  constructor(connectionString: string) {
    const mk = (name: string) => TableClient.fromConnectionString(connectionString, `cp${name}`);
    this.t = { meetings: mk("meetings"), tokens: mk("tokens"), usage: mk("usage"), flags: mk("flags") };
  }

  private init() {
    this.ready ??= Promise.all(Object.values(this.t).map((c) => c.createTable().catch(() => undefined)));
    return this.ready;
  }

  private async all<T>(c: TableClient): Promise<T[]> {
    await this.init();
    const out: T[] = [];
    for await (const e of c.listEntities<Row>()) out.push(JSON.parse(e.data) as T);
    return out;
  }
  private async get<T>(c: TableClient, rk: string): Promise<T | null> {
    await this.init();
    try {
      const e = await c.getEntity<Row>("p", rk);
      return JSON.parse(e.data) as T;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }
  private async put(c: TableClient, rk: string, value: unknown) {
    await this.init();
    await c.upsertEntity({ partitionKey: "p", rowKey: rk, data: JSON.stringify(value) }, "Replace");
  }

  listMeetings() {
    return this.all<Meeting>(this.t.meetings);
  }
  getMeeting(id: string) {
    return this.get<Meeting>(this.t.meetings, id);
  }
  putMeeting(m: Meeting) {
    return this.put(this.t.meetings, m.id, m);
  }
  async deleteMeeting(id: string) {
    await this.init();
    await this.t.meetings.deleteEntity("p", id).catch(() => undefined);
  }
  listTokens() {
    return this.all<AccessTokenInfo>(this.t.tokens);
  }
  putToken(t: AccessTokenInfo) {
    return this.put(this.t.tokens, t.id, t);
  }
  async getUsage(month: string) {
    return (await this.get<UsageMonth>(this.t.usage, month)) ?? { month, hours: 0, usd: 0, lastSampleAt: null };
  }
  putUsage(u: UsageMonth) {
    return this.put(this.t.usage, u.month, u);
  }
  async getFlag(key: string) {
    return this.get<string>(this.t.flags, key);
  }
  async setFlag(key: string, value: string | null) {
    if (value === null) {
      await this.init();
      await this.t.flags.deleteEntity("p", key).catch(() => undefined);
    } else await this.put(this.t.flags, key, value);
  }
}

export class MemoryStore implements Store {
  meetings = new Map<string, Meeting>();
  tokens = new Map<string, AccessTokenInfo>();
  usage = new Map<string, UsageMonth>();
  flags = new Map<string, string>();
  async listMeetings() {
    return [...this.meetings.values()];
  }
  async getMeeting(id: string) {
    return this.meetings.get(id) ?? null;
  }
  async putMeeting(m: Meeting) {
    this.meetings.set(m.id, structuredClone(m));
  }
  async deleteMeeting(id: string) {
    this.meetings.delete(id);
  }
  async listTokens() {
    return [...this.tokens.values()];
  }
  async putToken(t: AccessTokenInfo) {
    this.tokens.set(t.id, structuredClone(t));
  }
  async getUsage(month: string) {
    return this.usage.get(month) ?? { month, hours: 0, usd: 0, lastSampleAt: null };
  }
  async putUsage(u: UsageMonth) {
    this.usage.set(u.month, { ...u });
  }
  async getFlag(key: string) {
    return this.flags.get(key) ?? null;
  }
  async setFlag(key: string, value: string | null) {
    if (value === null) this.flags.delete(key);
    else this.flags.set(key, value);
  }
}
