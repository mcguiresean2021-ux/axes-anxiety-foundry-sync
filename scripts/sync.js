const MODULE_ID = "axes-anxiety-sync";
const DEFAULT_URL = "https://sdvcpfdogthmeeotykxy.supabase.co";
const DEFAULT_KEY = "sb_publishable_dcHBBjqZEf2WwrPzCo5fCw_jNORzTha";
let syncTimer;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "supabaseUrl", {
    name: "Supabase Project URL", scope: "world", config: true,
    type: String, default: DEFAULT_URL
  });
  game.settings.register(MODULE_ID, "supabaseKey", {
    name: "Supabase Publishable Key",
    hint: "Use only the browser-safe publishable key. Never use service_role here.",
    scope: "world", config: true, type: String, default: DEFAULT_KEY
  });
  game.settings.register(MODULE_ID, "autoSync", {
    name: "Automatic Portal Sync",
    hint: "Automatically sync player character changes after a short delay.",
    scope: "world", config: true, type: Boolean, default: false
  });
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  globalThis.AxesAnxietySync = { syncParty };
  ui.notifications.info("Axes & Anxiety Portal Sync ready.");
});

for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (doc) => {
    if (!game.user.isGM || !game.settings.get(MODULE_ID, "autoSync")) return;
    const actor = doc.documentName === "Actor" ? doc : doc.parent;
    if (!actor || actor.documentName !== "Actor") return;
    if (!getPlayerActors().some(a => a.id === actor.id)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncParty(false), 1500);
  });
}

function getPlayerActors() {
  return game.actors.filter(actor =>
    actor.type === "character" &&
    Object.entries(actor.ownership ?? {}).some(([userId, level]) =>
      userId !== "default" && Number(level) >= 3
    )
  );
}

function stripHtml(html = "") {
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent || "").trim();
}

function itemData(item) {
  const s = item.system ?? {};
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    img: item.img ?? "",
    equipped: !!s.equipped,
    quantity: s.quantity ?? 1,
    rarity: s.rarity ?? "",
    activation: s.activation?.type ?? "",
    actionType: s.actionType ?? "",
    description: stripHtml(s.description?.value ?? "")
  };
}

function actorPayload(actor) {
  const s = actor.system ?? {};
  const items = actor.items.filter(i => i.system?.identified !== false);
  const classes = actor.items.filter(i => i.type === "class")
    .map(i => ({ name: i.name, levels: i.system?.levels ?? 0 }));

  return {
    foundryActorId: actor.id,
    name: actor.name,
    img: actor.img ?? "",
    updatedAt: new Date().toISOString(),
    classes,
    level: classes.reduce((n, c) => n + (Number(c.levels) || 0), 0),
    hp: {
      value: s.attributes?.hp?.value ?? null,
      max: s.attributes?.hp?.max ?? null,
      temp: s.attributes?.hp?.temp ?? null
    },
    ac: s.attributes?.ac?.value ?? null,
    abilities: s.abilities ?? {},
    spellDC: s.attributes?.spelldc ?? null,
    inventory: items.filter(i =>
      ["weapon","equipment","consumable","tool","loot","container","backpack"].includes(i.type)
    ).map(itemData),
    spells: items.filter(i => i.type === "spell").map(itemData),
    features: items.filter(i =>
      ["feat","background","subclass"].includes(i.type)
    ).map(itemData)
  };
}

async function syncParty(notify = true) {
  const url = game.settings.get(MODULE_ID, "supabaseUrl").replace(/\/$/, "");
  const key = game.settings.get(MODULE_ID, "supabaseKey");
  const actors = getPlayerActors();

  if (!actors.length) {
    ui.notifications.warn("Axes & Anxiety: no player-owned character actors found.");
    return;
  }

  const rows = actors.map(actor => ({
    foundry_actor_id: actor.id,
    character_name: actor.name,
    payload: actorPayload(actor),
    synced_at: new Date().toISOString()
  }));

  try {
    const response = await fetch(
      `${url}/rest/v1/foundry_characters?on_conflict=foundry_actor_id`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rows)
      }
    );

    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    if (notify) ui.notifications.info(`Axes & Anxiety: synced ${actors.length} character(s).`);
  } catch (error) {
    console.error("Axes & Anxiety Portal Sync", error);
    ui.notifications.error(`Axes & Anxiety sync failed: ${error.message}`);
  }
}