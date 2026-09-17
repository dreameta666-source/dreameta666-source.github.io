import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "source");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, s) => { const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s, "utf8"); };
function replaceOnce(file, from, to) {
  let s = read(file);
  if (!s.includes(from)) throw new Error(`Patch anchor missing in ${file}: ${from.slice(0,120)}`);
  s = s.replace(from, to);
  write(file, s);
}

// ---- DPS state / RPC ----
replaceOnce("packages/combat/src/app-types.ts",
`  statType: StatType;\n  status: DpsAppStatus;`,
`  statType: StatType;\n  bossOnly: boolean;\n  bossName?: string;\n  status: DpsAppStatus;`);
replaceOnce("packages/combat/src/app-types.ts",
`      setStatType: { params: { statType: StatType }; response: DpsAppState };`,
`      setStatType: { params: { statType: StatType }; response: DpsAppState };\n      setBossOnly: { params: { enabled: boolean }; response: DpsAppState };`);

// ---- Persistent setting ----
replaceOnce("packages/combat/src/settings.ts",
`  statType: StatType;\n  frame:`,
`  statType: StatType;\n  bossOnly: boolean;\n  frame:`);
replaceOnce("packages/combat/src/settings.ts",
`  statType: "damage",\n  frame:`,
`  statType: "damage",\n  bossOnly: false,\n  frame:`);
replaceOnce("packages/combat/src/settings.ts",
`      statType: candidate.statType === "tanked" ? "tanked" : candidate.statType === "heal" ? "heal" : "damage",\n      frame:`,
`      statType: candidate.statType === "tanked" ? "tanked" : candidate.statType === "heal" ? "heal" : "damage",\n      bossOnly: candidate.bossOnly === true,\n      frame:`);

// ---- Live controller: second meter filtered to dominant monster target ----
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`  private meter: LiveCombatService;\n  private status:`,
`  private meter: LiveCombatService;\n  private bossMeter: LiveCombatService;\n  private bossTargetId?: number;\n  private bossTargetName?: string;\n  private readonly monsterNames = new Map<number, string>();\n  private readonly targetDamage = new Map<number, number>();\n  private bossBuffer: Array<DpsLogBatch["events"][number]> = [];\n  private status:`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`    this.meter = this.createMeter();\n    this.source =`,
`    this.meter = this.createMeter();\n    this.bossMeter = this.createMeter();\n    this.source =`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`  state(): LiveCombatState {\n    return {`,
`  state(bossOnly = false): LiveCombatState {\n    return {`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`      snapshots: this.snapshots(),\n    };\n  }\n\n  snapshots(): LiveCombatState["snapshots"] {\n    const record = this.latestRecord();\n    return record ? { snapshot: record.dps, tankedSnapshot: record.tps.detail, healSnapshot: record.hps.detail } : {};\n  }`,
`      snapshots: this.snapshots(bossOnly),\n    };\n  }\n\n  snapshots(bossOnly = false): LiveCombatState["snapshots"] {\n    const record = this.latestRecord();\n    const bossRecord = this.latestBossRecord();\n    if (!record) return {};\n    return {\n      ...(bossOnly ? (bossRecord ? { snapshot: bossRecord.dps } : {}) : { snapshot: record.dps }),\n      tankedSnapshot: record.tps.detail,\n      healSnapshot: record.hps.detail,\n    };\n  }\n\n  bossName(): string | undefined {\n    return this.bossTargetName;\n  }`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`    this.meter.setPersonalActorId(actorId);\n    this.publish();`,
`    this.meter.setPersonalActorId(actorId);\n    this.bossMeter.setPersonalActorId(actorId);\n    this.publish();`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`    this.meter.setPersonalName(nextName);\n    if (this.manualPersonalActorId !== undefined) {`,
`    this.meter.setPersonalName(nextName);\n    this.bossMeter.setPersonalName(nextName);\n    if (this.manualPersonalActorId !== undefined) {`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`      this.meter.setPersonalActorId(undefined);\n    }`,
`      this.meter.setPersonalActorId(undefined);\n      this.bossMeter.setPersonalActorId(undefined);\n    }`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`    this.meter = this.createMeter();\n    this.lastEventObservedAtMs = undefined;`,
`    this.meter = this.createMeter();\n    this.bossMeter = this.createMeter();\n    this.bossTargetId = undefined;\n    this.bossTargetName = undefined;\n    this.monsterNames.clear();\n    this.targetDamage.clear();\n    this.bossBuffer = [];\n    this.lastEventObservedAtMs = undefined;`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`    for (const { event, observedAtMs } of batch.events) {\n      if (event.kind === "activation") {`,
`    for (const item of batch.events) {\n      const { event, observedAtMs } = item;\n      if (event.kind === "activation") {`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`      if (event.kind === "actorIdentity") this.meter.consumeIdentity(event, observedAtMs);\n      else this.meter.consumeCombat(event, observedAtMs);\n      batchLastObservedAtMs = Math.max(batchLastObservedAtMs ?? observedAtMs, observedAtMs);`,
`      if (event.kind === "actorIdentity") this.meter.consumeIdentity(event, observedAtMs);\n      else this.meter.consumeCombat(event, observedAtMs);\n\n      this.bossBuffer.push(item);\n      if (this.bossBuffer.length > 250_000) this.bossBuffer.splice(0, 25_000);\n      const changed = this.observeBossCandidate(event as any);\n      if (changed) this.rebuildBossMeter();\n      else this.consumeBossEvent(event as any, observedAtMs);\n\n      batchLastObservedAtMs = Math.max(batchLastObservedAtMs ?? observedAtMs, observedAtMs);`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`    if (nowMs !== undefined) this.meter.advance(nowMs);`,
`    if (nowMs !== undefined) { this.meter.advance(nowMs); this.bossMeter.advance(nowMs); }`);
// replace second occurrence in tick too
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`    if (nowMs !== undefined) this.meter.advance(nowMs);\n    this.lastPublishMs = Date.now();`,
`    if (nowMs !== undefined) { this.meter.advance(nowMs); this.bossMeter.advance(nowMs); }\n    this.lastPublishMs = Date.now();`);
replaceOnce("packages/combat/src/bun/live-combat-controller.ts",
`  private latestRecord(): CombatEncounterRecord | undefined {\n    const state = this.meter.getState(this.relativeNowMs());\n    return state.current ?? state.latestFinished;\n  }`,
`  private latestRecord(): CombatEncounterRecord | undefined {\n    const state = this.meter.getState(this.relativeNowMs());\n    return state.current ?? state.latestFinished;\n  }\n\n  private latestBossRecord(): CombatEncounterRecord | undefined {\n    const state = this.bossMeter.getState(this.relativeNowMs());\n    return state.current ?? state.latestFinished;\n  }\n\n  private observeBossCandidate(event: any): boolean {\n    if (event.kind === "monsterIdentity") {\n      if (event.operation === "reset") this.monsterNames.clear();\n      else if (event.operation === "remove") this.monsterNames.delete(event.actorId);\n      else if (event.operation === "upsert") this.monsterNames.set(event.actorId, event.displayName);\n    }\n    if ((event.kind === "damage" || event.kind === "death") && event.targetId !== undefined && Number(event.value) > 0) {\n      this.targetDamage.set(event.targetId, (this.targetDamage.get(event.targetId) ?? 0) + Number(event.value));\n    }\n    let bestId: number | undefined;\n    let bestDamage = -1;\n    for (const [targetId, damage] of this.targetDamage) {\n      if (!this.monsterNames.has(targetId)) continue;\n      if (damage > bestDamage) { bestDamage = damage; bestId = targetId; }\n    }\n    if (bestId === undefined || bestId === this.bossTargetId) return false;\n    this.bossTargetId = bestId;\n    this.bossTargetName = this.monsterNames.get(bestId);\n    return true;\n  }\n\n  private consumeBossEvent(event: any, observedAtMs: number): void {\n    if (event.kind === "actorIdentity") {\n      this.bossMeter.consumeIdentity(event, observedAtMs);\n      return;\n    }\n    if (event.kind === "damage" || event.kind === "death") {\n      if (this.bossTargetId !== undefined && event.targetId === this.bossTargetId) this.bossMeter.consumeCombat(event, observedAtMs);\n      return;\n    }\n    // Keep activation/identity/status context so filtered hits retain normal attribution.\n    this.bossMeter.consumeCombat(event, observedAtMs);\n  }\n\n  private rebuildBossMeter(): void {\n    this.bossMeter = this.createMeter();\n    for (const { event, observedAtMs } of this.bossBuffer) this.consumeBossEvent(event as any, observedAtMs);\n    const nowMs = this.relativeNowMs();\n    if (nowMs !== undefined) this.bossMeter.advance(nowMs);\n  }`);

// ---- Controller / state ----
replaceOnce("packages/combat/src/bun/index.ts",
`      setStatType: ({ statType }) => {\n        settings.statType = statType;\n        scheduleSettingsSave();\n        publish();\n        return appState();\n      },`,
`      setStatType: ({ statType }) => {\n        settings.statType = statType;\n        scheduleSettingsSave();\n        publish();\n        return appState();\n      },\n      setBossOnly: ({ enabled }) => {\n        settings.bossOnly = enabled;\n        scheduleSettingsSave();\n        publish();\n        return appState();\n      },`);
replaceOnce("packages/combat/src/bun/index.ts",
`function appState(): DpsAppState {\n  const liveState = live.state();\n  return {\n    screen,\n    tab: settings.tab,\n    statType: settings.statType,`,
`function appState(): DpsAppState {\n  const bossOnlyActive = settings.bossOnly && settings.statType === "damage";\n  const liveState = live.state(bossOnlyActive);\n  return {\n    screen,\n    tab: settings.tab,\n    statType: settings.statType,\n    bossOnly: settings.bossOnly,\n    ...(live.bossName() === undefined ? {} : { bossName: live.bossName() }),`);
replaceOnce("packages/combat/src/bun/index.ts",
`    const liveState = live.state();\n    if (screen === "live" && liveState.logPath) {`,
`    const liveState = live.state(settings.bossOnly && settings.statType === "damage");\n    if (screen === "live" && liveState.logPath) {`);
replaceOnce("packages/combat/src/bun/index.ts",
`          ...liveState.snapshots,\n          statType: settings.statType,`,
`          ...liveState.snapshots,\n          statType: settings.statType,`);

// ---- Main UI boss-only toggle ----
replaceOnce("packages/combat/src/mainview/index.tsx",
`function setStatType(statType: StatType): void {\n  if (state.value) state.value = { ...state.value, statType };\n  void desktopView.rpc?.request.setStatType({ statType });\n}`,
`function setStatType(statType: StatType): void {\n  if (state.value) state.value = { ...state.value, statType };\n  void desktopView.rpc?.request.setStatType({ statType });\n}\n\nfunction setBossOnly(enabled: boolean): void {\n  if (state.value) state.value = { ...state.value, bossOnly: enabled };\n  void desktopView.rpc?.request.setBossOnly({ enabled });\n}`);
replaceOnce("packages/combat/src/mainview/index.tsx",
`        <div class="command-bar-actions">\n          {next.location !== undefined && <span class="zone-pill"`,
`        <div class="command-bar-actions">\n          {next.statType === "damage" && <label class="boss-only-toggle" title={t("combat.bossOnly.hint")}>\n            <input type="checkbox" checked={next.bossOnly} onChange={(event) => setBossOnly(event.currentTarget.checked)} />\n            <span>{t("combat.bossOnly.label")}</span>\n          </label>}\n          {next.statType === "damage" && next.bossOnly && <span class="zone-pill">{next.bossName ? t("combat.bossOnly.active", { name: next.bossName }) : t("combat.bossOnly.detecting")}</span>}\n          {next.location !== undefined && <span class="zone-pill"`);

// small CSS addition
const cssFile = "packages/combat/src/mainview/index.css";
let css = read(cssFile);
css += `\n/* Boss-only mode */\n.boss-only-toggle{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;white-space:nowrap;background:var(--surface-2)}\n.boss-only-toggle input{margin:0}\n`;
write(cssFile, css);

// ---- Traditional Chinese catalog ----
const zh = `export const zhTW = {
  "app.name": "Spirit Vale Overlay",
  "common.ok": "確定",
  "titleBar.minimize": "最小化", "titleBar.maximize": "最大化", "titleBar.restore": "還原", "titleBar.close": "關閉", "settingsButton.label": "設定",
  "chart.resetZoom": "重設縮放",
  "statType.label": "統計", "statType.aria": "統計類型", "statType.damage": "傷害 (DPS)", "statType.tanked": "承傷 (TPS)", "statType.heal": "治療 (HPS)",
  "enemyFilter.aria": "依敵人篩選", "enemyFilter.searchPlaceholder": "搜尋敵人", "enemyFilter.clear": "清除篩選", "enemyFilter.noMatch": "找不到符合「{query}」的敵人。", "enemyFilter.all": "所有敵人", "enemyFilter.count.one": "{count} 個敵人", "enemyFilter.count.other": "{count} 個敵人",
  "combat.window.tag": "DPS", "combat.logSource.label": "戰鬥紀錄來源", "combat.logSource.live": "即時", "combat.logSource.past": "歷史紀錄", "combat.zone.current": "目前地圖：{zone}",
  "combat.action.deathLog": "死亡紀錄", "combat.action.reset": "重設", "combat.totals.label": "本場總計", "combat.totals.timer": "時間", "combat.totals.encounter": "本場 {metric}", "combat.totals.damage": "總傷害", "combat.totals.damageTaken": "總承傷", "combat.totals.healing": "總治療", "combat.totals.kills": "擊殺數",
  "combat.tabs.label": "傷害檢視", "combat.tabs.all": "全隊 {metric}", "combat.tabs.personal": "個人", "combat.party.label": "隊伍傷害", "combat.party.empty": "開始戰鬥並辨識到玩家後會顯示傷害。", "combat.party.emptyHeal": "有人施放治療後會顯示治療量。", "combat.party.rowHint": "雙擊查看玩家即時明細",
  "combat.column.class": "職業", "combat.column.ign": "角色名稱", "combat.column.kills": "擊殺數", "combat.column.mobsHit": "命中怪物數", "combat.column.critRate": "暴擊率", "combat.column.share": "占比", "combat.column.hits": "命中", "combat.column.crits": "暴擊", "combat.column.critRateLong": "暴擊率", "combat.column.skill": "技能", "combat.column.attackerSkill": "攻擊技能", "combat.column.absorbed": "吸收", "combat.column.amountPercent": "{amount}%", "combat.column.player": "玩家",
  "combat.personal.detected": "偵測到的角色", "combat.personal.waiting": "等待偵測角色…", "combat.personal.actorLabel": "傷害角色", "combat.personal.actorAria": "個人傷害角色", "combat.personal.actorAuto": "自動（角色名稱或本機動作）", "combat.personal.actorOption": "{name} · {damage} 傷害", "combat.personal.unconfigured": "等待偵測目前角色。", "combat.personal.missing": "等待 {name} 出現在目前戰鬥。", "combat.personal.ambiguous": "有多名可見玩家使用相同名稱。", "combat.personal.matched": "已配對目前戰鬥。", "combat.personal.skills.label": "個人技能傷害", "combat.personal.skills.empty": "目前沒有個人技能傷害。", "combat.personal.skills.unmatched": "配對角色後才會顯示個人技能。",
  "combat.bossOnly.label": "只看 BOSS", "combat.bossOnly.hint": "只統計目前主要 BOSS 目標受到的傷害；BOSS 以本場承受傷害最高的怪物自動辨識。", "combat.bossOnly.detecting": "偵測 BOSS 中…", "combat.bossOnly.active": "BOSS：{name}",
  "combat.past.back": "← 返回", "combat.past.encounter": "戰鬥", "combat.past.deathLog": "死亡紀錄", "combat.past.totals.label": "歷史戰鬥總計", "combat.past.totals.party": "隊伍 {metric}", "combat.past.totals.total": "總計 {amount}", "combat.past.totals.duration": "持續時間", "combat.past.totals.players": "玩家數", "combat.past.players.label": "玩家分析", "combat.past.players.heading": "玩家 {amount}", "combat.past.players.hint": "雙擊玩家查看技能與傷害時間軸。", "combat.past.players.rowHint": "雙擊查看玩家明細", "combat.past.players.empty": "此場戰鬥沒有 {amount} 資料。",
  "amount.damage": "傷害", "amount.damageTaken": "承受傷害", "amount.healing": "治療",
  "detail.window.tag": "玩家明細", "detail.metric.perFive": "{metric} / 5 秒", "detail.metric.cumulative": "累計", "detail.totals.label": "玩家總計", "detail.metric.hits": "命中", "detail.metric.kills": "擊殺", "detail.metric.critHits": "暴擊次數", "detail.metric.critRate": "暴擊率", "detail.chart.heading": "{amount} 時間軸", "detail.chart.show": "顯示圖表", "detail.chart.hide": "隱藏圖表", "detail.skills.heading": "技能明細", "detail.skills.hint": "{amount}、{metric}、命中與暴擊表現。", "detail.column.skill": "技能", "detail.column.attackerSkill": "攻擊技能", "detail.column.share": "占比", "detail.column.hits": "命中", "detail.column.crits": "暴擊", "detail.column.critRate": "暴擊率",
  "sessions.title.pastCombatLogs": "歷史戰鬥紀錄", "sessions.title.rewardsReplays": "獎勵重播", "sessions.heading": "最近紀錄", "sessions.refresh": "重新整理", "sessions.loading": "載入最近紀錄…", "sessions.chooseFile": "選擇 JSON 檔…", "sessions.openFolder": "開啟紀錄資料夾", "sessions.open": "開啟", "sessions.active": "進行中", "sessions.filters.from": "從", "sessions.filters.to": "到", "sessions.filters.chooseDate": "選擇日期", "sessions.filters.fromTime": "開始時間", "sessions.filters.toTime": "結束時間", "sessions.filters.clear": "清除", "sessions.filters.apply": "套用", "sessions.filters.zones": "地圖", "sessions.filters.searchZones": "搜尋地圖", "sessions.filters.allZones": "所有地圖",
  "combat.status.lookingForSession": "正在尋找戰鬥紀錄…", "combat.status.lookingForFile": "正在尋找 {file}…", "combat.status.logUnreadable": "無法讀取選取的戰鬥紀錄。", "combat.status.loadingLog": "正在載入戰鬥紀錄…", "combat.status.readFailed": "無法讀取 {file}", "combat.status.waitingForFile": "等待 {file}", "combat.status.reading": "正在讀取 {file}", "combat.status.watching": "監看 {file}", "combat.status.noPlayerDamage": "此紀錄沒有玩家傷害。",
  "launcher.brandTag": "工具", "launcher.capture.heading": "中央擷取", "launcher.tools.label": "Spirit Vale 工具", "launcher.tool.combat": "戰鬥", "launcher.tool.combat.description": "即時 DPS 與戰鬥重播", "launcher.tool.rewards": "獎勵", "launcher.tool.rewards.description": "怪物獎勵與圖鑑", "launcher.tool.character": "角色", "launcher.tool.character.description": "角色配裝與計算屬性", "launcher.tool.bossTimers": "BOSS 計時器", "launcher.tool.bossTimers.description": "依區域與頻道顯示世界 BOSS 重生", "launcher.tool.buildExport": "Build 匯出", "launcher.manageSettings.title": "管理設定", "launcher.manageSettings.description": "匯入、定位或重設設定", "launcher.hint.editOverlay": "編輯 Overlay", "launcher.hint.toggleOverlay": "切換 Overlay", "launcher.logs.label": "紀錄", "launcher.update.heading": "有新版本", "launcher.update.body": "GitHub 上有版本 {version}。", "launcher.update.view": "查看下載", "launcher.update.skip": "略過此版本", "launcher.update.dismiss": "關閉",
  "settings.window.title": "Spirit Vale Overlay 設定", "settings.window.tag": "設定", "settings.nav.label": "設定分類", "settings.search.placeholder": "搜尋設定", "settings.search.label": "搜尋全部設定", "settings.search.results.heading": "搜尋結果", "settings.search.empty": "沒有符合「{query}」的設定。",
  "settings.general.label": "一般", "settings.general.description": "設定程式行為與外觀。", "settings.general.interfaceScale.label": "介面縮放", "settings.general.minimizeToTray.label": "將啟動器縮到系統列",
  "settings.network.label": "網路", "settings.network.description": "Npcap 封包擷取設定。", "settings.network.npcapStatus.label": "狀態", "settings.network.adapter.label": "網路介面卡", "settings.network.adapter.auto": "自動（預設路由）", "settings.network.adapter.unavailable": "已儲存的介面卡（目前不可用）", "settings.network.actions.refresh": "重新整理", "settings.network.actions.getNpcap": "取得 Npcap",
  "settings.combat.label": "戰鬥", "settings.combat.description": "控制戰鬥追蹤方式。", "settings.combat.resetMeter.label": "切換地圖／頻道時重設計量", "settings.combat.resetMeter.hint": "切換地圖或頻道時建立新場次，效果與「重設場次」快捷鍵相同。", "settings.combat.resetGold.label": "切換地圖／頻道時重設金幣", "settings.combat.resetGold.hint": "切換地圖或頻道時重設累積金幣統計。", "settings.combat.pastLogLimit.label": "顯示的歷史場次", "settings.combat.pastLogLimit.hint": "套用於戰鬥歷史紀錄與獎勵重播，可設定 100 到 100,000 場。", "settings.combat.personalDps.label": "個人 DPS 顯示", "settings.combat.personalDps.encounter": "整場平均", "settings.combat.personalDps.live": "即時（近期速率）",
  "settings.overlay.label": "Overlay", "settings.overlay.description": "設定遊戲內 Overlay 的顯示方式。", "settings.overlay.enabled.label": "啟用 Overlay", "settings.overlay.locked.label": "鎖定 Overlay", "settings.overlay.opacity.label": "透明度",
  "settings.hotkeys.label": "快捷鍵", "settings.hotkeys.description": "設定鍵盤快捷鍵。",
  "settings.language.label": "語言", "settings.language.description": "選擇介面語言。",
  "deathLog.window.tag": "死亡紀錄", "deathLog.heading": "玩家死亡", "deathLog.empty": "此紀錄沒有玩家死亡。", "deathLog.deaths": "死亡", "deathLog.mostRecent": "最新的排最前面。", "deathLog.searchPlayer": "搜尋玩家", "deathLog.column.attacker": "攻擊者", "deathLog.column.source": "來源", "deathLog.column.damage": "傷害", "deathLog.column.hits": "命中", "deathLog.column.crits": "暴擊", "deathLog.critical": "暴擊", "deathLog.normal": "一般"
} as const;\n`;
write("packages/i18n/locales/zh-TW.ts", zh);
replaceOnce("packages/i18n/locale.ts",
`import { en } from "./locales/en.ts";`,
`import { en } from "./locales/en.ts";\nimport { zhTW } from "./locales/zh-TW.ts";`);
replaceOnce("packages/i18n/locale.ts",
`export const LOCALES = { en } satisfies Record<string, PartialMessages>;`,
`export const LOCALES = { en, "zh-TW": zhTW } satisfies Record<string, PartialMessages>;`);
replaceOnce("packages/i18n/locale.ts",
`export const DEFAULT_LOCALE: LocaleCode = "en";`,
`export const DEFAULT_LOCALE: LocaleCode = "zh-TW";`);
replaceOnce("packages/i18n/translate.ts",
`import { en } from "./locales/en.ts";`,
`import { en } from "./locales/en.ts";\nimport { zhTW } from "./locales/zh-TW.ts";`);
replaceOnce("packages/i18n/translate.ts",
`  const catalog: Record<string, string | undefined> = en;\n  const pluralRules = new Intl.PluralRules(DEFAULT_LOCALE);`,
`  const catalog: Record<string, string | undefined> = locale === "zh-TW" ? { ...en, ...zhTW } : en;\n  const pluralRules = new Intl.PluralRules(locale);`);

console.log("Spirit Vale Overlay zh-TW + boss-only patch applied.");
