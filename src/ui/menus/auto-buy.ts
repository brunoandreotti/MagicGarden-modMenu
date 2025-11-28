// src/ui/menus/auto-buy.ts
// Auto-Buy menu for configuring automatic purchases of seeds and eggs

import { Menu } from "../menu";
import {
  loadAutoBuySettings,
  getAutoBuySettings,
  setAutoBuySettings,
  setSeedConfig,
  setEggConfig,
  updateAutoBuySettings,
  onAutoBuySettingsChange,
  AVAILABLE_SEEDS,
  AVAILABLE_EGGS,
  getEggDisplayName,
  type AutoBuySettings,
  type AutoBuyItemConfig,
} from "../../store/auto-buy";
import { ShopService } from "../../services/shop";
import { NotifierService, type ShopsSnapshot } from "../../services/notifier";
import { audio } from "../../utils/audio";
import { createShopSprite } from "../../utils/shopSprites";
import { plantCatalog, eggCatalog } from "../../data/hardcoded-data.clean";

// === Rarity Helper Functions ===

const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythical", "Divine", "Celestial"];

const RARITY_MAP: Record<string, string> = {
  mythical: "Mythical",
  celestial: "Celestial",
  divine: "Divine",
  legendary: "Legendary",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
  epic: "Epic",
};

function normalizeRarity(rarity: string | undefined): string {
  const key = String(rarity || "").toLowerCase();
  return RARITY_MAP[key] || "Common";
}

function getSeedRarity(speciesId: string): string {
  const entry = (plantCatalog as Record<string, any>)?.[speciesId];
  return normalizeRarity(entry?.seed?.rarity || entry?.plant?.rarity);
}

function getEggRarity(eggId: string): string {
  const entry = (eggCatalog as Record<string, any>)?.[eggId];
  return normalizeRarity(entry?.rarity);
}

function sortByRarityOrder(rarities: string[]): string[] {
  return rarities.sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
}

interface ItemWithRarity {
  id: string;
  name: string;
  rarity: string;
  config: AutoBuyItemConfig;
}

function groupSeedsByRarity(settings: AutoBuySettings): Map<string, ItemWithRarity[]> {
  const grouped = new Map<string, ItemWithRarity[]>();
  
  for (const seedId of AVAILABLE_SEEDS) {
    const rarity = getSeedRarity(seedId);
    const config = settings.selectedSeeds[seedId] || { enabled: false, quantity: 999 };
    
    if (!grouped.has(rarity)) {
      grouped.set(rarity, []);
    }
    
    grouped.get(rarity)!.push({
      id: seedId,
      name: seedId,
      rarity,
      config,
    });
  }
  
  return grouped;
}

function groupEggsByRarity(settings: AutoBuySettings): Map<string, ItemWithRarity[]> {
  const grouped = new Map<string, ItemWithRarity[]>();
  
  for (const eggId of AVAILABLE_EGGS) {
    const rarity = getEggRarity(eggId);
    const config = settings.selectedEggs[eggId] || { enabled: false, quantity: 999 };
    
    if (!grouped.has(rarity)) {
      grouped.set(rarity, []);
    }
    
    grouped.get(rarity)!.push({
      id: eggId,
      name: getEggDisplayName(eggId),
      rarity,
      config,
    });
  }
  
  return grouped;
}

// === Rarity Badge Creator ===

function createRarityBadge(rarity: string): HTMLElement {
  const normalized = normalizeRarity(rarity);
  
  const COLORS: Record<string, string | null> = {
    Common: "#E7E7E7",
    Uncommon: "#67BD4D",
    Rare: "#0071C6",
    Epic: "#9944A7",
    Legendary: "#FFC734",
    Mythical: "#9944A7",
    Divine: "#FF7835",
    Celestial: null,
  };

  const darkText = new Set(["Common", "Uncommon", "Legendary", "Divine"]);

  const badge = document.createElement("span");
  badge.textContent = normalized;
  Object.assign(badge.style, {
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: "700",
    color: darkText.has(normalized) ? "#0b0b0b" : "#ffffff",
    boxShadow: "0 0 0 1px #0006 inset",
    lineHeight: "1.1",
    whiteSpace: "nowrap",
  } as CSSStyleDeclaration);

  if (normalized === "Celestial") {
    // Ensure celestial animation keyframes exist
    if (!document.getElementById("qws-celestial-kf")) {
      const style = document.createElement("style");
      style.id = "qws-celestial-kf";
      style.textContent = `
@keyframes qwsCelestialShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}`;
      document.head.appendChild(style);
    }
    badge.style.background = `linear-gradient(130deg, rgb(0,180,216) 0%, rgb(124,42,232) 40%, rgb(160,0,126) 60%, rgb(255,215,0) 100%)`;
    badge.style.backgroundSize = "200% 200%";
    badge.style.animation = "qwsCelestialShift 4s linear infinite";
  } else {
    badge.style.background = COLORS[normalized] || "#444";
  }

  return badge;
}

// Initialize auto-buy listener for restock detection
let restockListenerInitialized = false;
let lastShopsSnapshot: ShopsSnapshot | null = null;

/**
 * Detects restock by checking if secondsUntilRestock increased in any shop section.
 * Uses the same proven logic from notificationOverlay.ts.
 */
function detectRestockFromSnapshots(prev: ShopsSnapshot | null, next: ShopsSnapshot): boolean {
  if (!prev || !next) return false;
  
  // Restock is detected when secondsUntilRestock INCREASES (timer resets)
  // e.g., timer goes from 5 seconds to 600 seconds (new 10 minute countdown)
  return !!(
    (prev.seed?.secondsUntilRestock  ?? 0) < (next.seed?.secondsUntilRestock  ?? 0) ||
    (prev.tool?.secondsUntilRestock  ?? 0) < (next.tool?.secondsUntilRestock  ?? 0) ||
    (prev.egg?.secondsUntilRestock   ?? 0) < (next.egg?.secondsUntilRestock   ?? 0) ||
    (prev.decor?.secondsUntilRestock ?? 0) < (next.decor?.secondsUntilRestock ?? 0)
  );
}

/**
 * Execute auto-buy purchases and handle notifications
 */
async function executeAutoBuy(settings: AutoBuySettings): Promise<void> {
  try {
    const result = await ShopService.executeAutoBuy(settings);
    
    const totalPurchased = 
      Object.values(result.seedsPurchased).reduce((a, b) => a + b, 0) +
      Object.values(result.eggsPurchased).reduce((a, b) => a + b, 0);
    
    if (totalPurchased > 0) {
      console.log(`[AutoBuy] Successfully purchased ${totalPurchased} items`);
      
      if (settings.playSound) {
        try {
          await audio.notify("shops");
        } catch (error) {
          console.error("[AutoBuy] Failed to play sound:", error);
        }
      }
    } else {
      console.log("[AutoBuy] Restock detected but no items were purchased (check configuration)");
    }
  } catch (error) {
    console.error("[AutoBuy] Error during auto-buy execution:", error);
  }
}

function initRestockListener() {
  if (restockListenerInitialized) return;
  restockListenerInitialized = true;

  console.log("[AutoBuy] Initializing restock listener with NotifierService");

  // Use NotifierService which already has reliable shop change detection
  NotifierService.onShopsChange((shopsSnapshot: ShopsSnapshot) => {
    const prev = lastShopsSnapshot;
    lastShopsSnapshot = shopsSnapshot;

    // Check if this is a restock using the same logic as NotificationOverlay
    const isRestock = detectRestockFromSnapshots(prev, shopsSnapshot);
    
    if (!isRestock) return;

    const settings = getAutoBuySettings();
    if (!settings.enabled) {
      console.log("[AutoBuy] Restock detected but auto-buy is disabled");
      return;
    }

    console.log("[AutoBuy] 🎉 Restock detected, executing auto-buy...");
    
    // Execute auto-buy asynchronously, handling errors properly
    executeAutoBuy(settings).catch((error) => {
      console.error("[AutoBuy] Unhandled error during auto-buy:", error);
    });
  });
}

function createSwitch(initialChecked: boolean, onToggle?: (checked: boolean) => void) {
  const wrap = document.createElement("label");
  wrap.style.display = "inline-flex";
  wrap.style.alignItems = "center";
  wrap.style.cursor = "pointer";
  wrap.style.userSelect = "none";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = initialChecked;
  input.className = "qmm-switch";
  
  input.addEventListener("change", () => {
    onToggle?.(input.checked);
  });

  wrap.appendChild(input);
  
  return { wrap, input };
}

// Helper to get the wrapper element from an input (Menu.inputNumber returns an input with a .wrap property)
function getInputWrapper(input: HTMLInputElement): HTMLElement {
  const inputWithWrap = input as HTMLInputElement & { wrap?: HTMLElement };
  return inputWithWrap.wrap ?? input;
}

function createItemRow(
  container: HTMLElement,
  itemId: string,
  displayName: string,
  config: AutoBuyItemConfig | undefined,
  onConfigChange: (config: AutoBuyItemConfig) => void,
  ui: Menu,
  itemType: 'seed' | 'egg' = 'seed'
) {
  const currentConfig = config || { enabled: false, quantity: 999 };

  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "36px 1fr auto auto";
  row.style.alignItems = "center";
  row.style.gap = "10px";
  row.style.padding = "8px 10px";
  row.style.borderRadius = "8px";
  row.style.background = currentConfig.enabled 
    ? "rgba(122, 162, 255, 0.1)" 
    : "rgba(0, 0, 0, 0.15)";
  row.style.border = currentConfig.enabled 
    ? "1px solid rgba(122, 162, 255, 0.3)" 
    : "1px solid rgba(255, 255, 255, 0.06)";
  row.style.transition = "background 0.2s ease, border-color 0.2s ease";

  // Hover effect
  row.addEventListener("mouseenter", () => {
    if (!currentConfig.enabled) {
      row.style.background = "rgba(0, 0, 0, 0.25)";
    }
  });
  row.addEventListener("mouseleave", () => {
    row.style.background = currentConfig.enabled 
      ? "rgba(122, 162, 255, 0.1)" 
      : "rgba(0, 0, 0, 0.15)";
  });

  // Icon container
  const iconContainer = document.createElement("div");
  Object.assign(iconContainer.style, {
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    background: "#101820",
    border: "1px solid #ffffff12",
    flexShrink: "0",
  });

  const sprite = createShopSprite(
    itemType === 'seed' ? 'Seed' : 'Egg',
    itemId,
    {
      size: 28,
      fallback: itemType === 'seed' ? '🌱' : '🥚',
      alt: displayName,
    }
  );
  iconContainer.appendChild(sprite);

  // Name label
  const label = document.createElement("label");
  label.textContent = displayName;
  label.style.fontWeight = "600";
  label.style.fontSize = "14px";
  label.style.cursor = "pointer";
  label.style.userSelect = "none";
  label.style.color = currentConfig.enabled ? "#e7eef7" : "#b9c3cf";
  label.htmlFor = `autobuy-${itemType}-${itemId}`;

  // Checkbox
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = `autobuy-${itemType}-${itemId}`;
  checkbox.checked = currentConfig.enabled;
  checkbox.className = "qmm-switch";
  checkbox.style.cursor = "pointer";

  // Quantity wrapper
  const qtyWrap = document.createElement("div");
  qtyWrap.style.display = "flex";
  qtyWrap.style.alignItems = "center";
  qtyWrap.style.gap = "6px";

  const qtyLabel = document.createElement("span");
  qtyLabel.textContent = "Qtd:";
  qtyLabel.style.fontSize = "13px";
  qtyLabel.style.opacity = "0.8";
  qtyLabel.style.fontWeight = "600";

  const qtyInput = ui.inputNumber(1, 9999, 1, currentConfig.quantity);
  qtyInput.style.width = "70px";
  qtyInput.style.padding = "4px 8px";
  qtyInput.style.fontSize = "13px";
  qtyInput.disabled = !currentConfig.enabled;

  qtyWrap.append(qtyLabel, getInputWrapper(qtyInput));

  // Event handlers
  const updateConfig = () => {
    const newConfig: AutoBuyItemConfig = {
      enabled: checkbox.checked,
      quantity: parseInt(qtyInput.value, 10) || 999,
    };
    onConfigChange(newConfig);
    
    // Update visual state
    row.style.background = newConfig.enabled 
      ? "rgba(122, 162, 255, 0.1)" 
      : "rgba(0, 0, 0, 0.15)";
    row.style.border = newConfig.enabled 
      ? "1px solid rgba(122, 162, 255, 0.3)" 
      : "1px solid rgba(255, 255, 255, 0.06)";
    label.style.color = newConfig.enabled ? "#e7eef7" : "#b9c3cf";
    qtyInput.disabled = !newConfig.enabled;
  };

  checkbox.addEventListener("change", updateConfig);
  qtyInput.addEventListener("change", updateConfig);
  label.addEventListener("click", () => {
    checkbox.checked = !checkbox.checked;
    updateConfig();
  });

  row.append(iconContainer, label, checkbox, qtyWrap);
  container.appendChild(row);
}

// Function to create rarity section header
function createRaritySectionHeader(rarity: string, itemCount: number): HTMLElement {
  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "8px";
  header.style.marginBottom = "8px";
  header.style.padding = "6px 10px";
  header.style.background = "rgba(0, 0, 0, 0.2)";
  header.style.borderRadius = "6px";
  header.style.fontWeight = "700";
  header.style.fontSize = "13px";
  
  const rarityBadge = createRarityBadge(rarity);
  
  const countSpan = document.createElement("span");
  countSpan.textContent = `(${itemCount})`;
  countSpan.style.opacity = "0.7";
  countSpan.style.fontSize = "12px";
  
  header.append(rarityBadge, countSpan);
  return header;
}

export function renderAutoBuyMenu(root: HTMLElement) {
  const ui = new Menu({ id: "auto-buy", compact: true, windowSelector: ".qws-win" });
  
  // Initialize restock listener
  initRestockListener();

  ui.addTab("config", "⚙️ Configuration", (view) => {
    view.innerHTML = "";
    
    const settings = loadAutoBuySettings();
    
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "16px";
    container.style.maxHeight = "54vh";
    container.style.overflowY = "auto";
    container.style.padding = "4px";

    // ========== Main Controls ==========
    const mainCard = ui.card("🛒 Auto-Buy Settings", { tone: "muted" });
    mainCard.body.style.display = "flex";
    mainCard.body.style.flexDirection = "column";
    mainCard.body.style.gap = "12px";

    // Enable toggle
    const enableRow = document.createElement("div");
    enableRow.style.display = "flex";
    enableRow.style.alignItems = "center";
    enableRow.style.justifyContent = "space-between";
    enableRow.style.padding = "10px 12px";
    enableRow.style.borderRadius = "10px";
    enableRow.style.background = "rgba(255, 255, 255, 0.05)";
    enableRow.style.border = "1px solid rgba(255, 255, 255, 0.1)";

    const enableLabel = document.createElement("div");
    enableLabel.innerHTML = `
      <div style="font-weight: 600;">Auto-compra no Restock</div>
      <div style="font-size: 12px; opacity: 0.7;">Compra automaticamente quando a loja atualizar</div>
    `;

    const enableSwitch = createSwitch(settings.enabled, (checked) => {
      updateAutoBuySettings({ enabled: checked });
    });

    enableRow.append(enableLabel, enableSwitch.wrap);
    mainCard.body.appendChild(enableRow);

    // Sound toggle
    const soundRow = document.createElement("div");
    soundRow.style.display = "flex";
    soundRow.style.alignItems = "center";
    soundRow.style.justifyContent = "space-between";
    soundRow.style.padding = "10px 12px";
    soundRow.style.borderRadius = "10px";
    soundRow.style.background = "rgba(255, 255, 255, 0.05)";
    soundRow.style.border = "1px solid rgba(255, 255, 255, 0.1)";

    const soundLabel = document.createElement("div");
    soundLabel.innerHTML = `
      <div style="font-weight: 600;">🔔 Tocar som ao comprar</div>
      <div style="font-size: 12px; opacity: 0.7;">Notificação sonora quando compras são feitas</div>
    `;

    const soundSwitch = createSwitch(settings.playSound, (checked) => {
      updateAutoBuySettings({ playSound: checked });
    });

    soundRow.append(soundLabel, soundSwitch.wrap);
    mainCard.body.appendChild(soundRow);

    container.appendChild(mainCard.root);

    // ========== Seeds Section ==========
    const seedsCard = ui.card("🌱 Sementes", { tone: "muted" });
    seedsCard.body.style.display = "flex";
    seedsCard.body.style.flexDirection = "column";
    seedsCard.body.style.gap = "12px";

    // Group seeds by rarity
    const seedsByRarity = groupSeedsByRarity(settings);
    const seedRarities = sortByRarityOrder(Array.from(seedsByRarity.keys()));
    
    for (const rarity of seedRarities) {
      const items = seedsByRarity.get(rarity)!;
      
      // Create rarity section container
      const raritySection = document.createElement("div");
      raritySection.style.marginBottom = "4px";
      
      // Add rarity header
      const header = createRaritySectionHeader(rarity, items.length);
      raritySection.appendChild(header);
      
      // Add items list
      const itemsList = document.createElement("div");
      itemsList.style.display = "flex";
      itemsList.style.flexDirection = "column";
      itemsList.style.gap = "6px";
      itemsList.style.paddingLeft = "4px";
      
      for (const item of items) {
        createItemRow(
          itemsList,
          item.id,
          item.name,
          item.config,
          (config) => setSeedConfig(item.id, config),
          ui,
          'seed'
        );
      }
      
      raritySection.appendChild(itemsList);
      seedsCard.body.appendChild(raritySection);
    }

    container.appendChild(seedsCard.root);

    // ========== Eggs Section ==========
    const eggsCard = ui.card("🥚 Ovos", { tone: "muted" });
    eggsCard.body.style.display = "flex";
    eggsCard.body.style.flexDirection = "column";
    eggsCard.body.style.gap = "12px";

    // Group eggs by rarity
    const eggsByRarity = groupEggsByRarity(settings);
    const eggRarities = sortByRarityOrder(Array.from(eggsByRarity.keys()));
    
    for (const rarity of eggRarities) {
      const items = eggsByRarity.get(rarity)!;
      
      // Create rarity section container
      const raritySection = document.createElement("div");
      raritySection.style.marginBottom = "4px";
      
      // Add rarity header
      const header = createRaritySectionHeader(rarity, items.length);
      raritySection.appendChild(header);
      
      // Add items list
      const itemsList = document.createElement("div");
      itemsList.style.display = "flex";
      itemsList.style.flexDirection = "column";
      itemsList.style.gap = "6px";
      itemsList.style.paddingLeft = "4px";
      
      for (const item of items) {
        createItemRow(
          itemsList,
          item.id,
          item.name,
          item.config,
          (config) => setEggConfig(item.id, config),
          ui,
          'egg'
        );
      }
      
      raritySection.appendChild(itemsList);
      eggsCard.body.appendChild(raritySection);
    }

    container.appendChild(eggsCard.root);

    // ========== Info Section ==========
    const infoCard = ui.card("ℹ️ Informações", { tone: "muted" });
    infoCard.body.style.fontSize = "13px";
    infoCard.body.style.opacity = "0.8";
    infoCard.body.style.lineHeight = "1.5";
    infoCard.body.innerHTML = `
      <ul style="margin: 0; padding-left: 20px;">
        <li>O Auto-Buy detecta quando a loja faz restock</li>
        <li>Compra automaticamente os itens selecionados</li>
        <li>Define a quantidade máxima que deseja comprar</li>
        <li>Se não houver estoque suficiente, compra o disponível</li>
        <li>As configurações são salvas automaticamente</li>
      </ul>
    `;

    container.appendChild(infoCard.root);

    view.appendChild(container);
  });

  ui.addTab("manual", "🛍️ Compra Manual", (view) => {
    view.innerHTML = "";
    
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "16px";
    container.style.maxHeight = "54vh";
    container.style.overflowY = "auto";
    container.style.padding = "4px";

    // Manual buy card
    const manualCard = ui.card("🛍️ Compra Manual", { tone: "muted" });
    manualCard.body.style.display = "flex";
    manualCard.body.style.flexDirection = "column";
    manualCard.body.style.gap = "12px";

    const description = document.createElement("div");
    description.textContent = "Compre itens manualmente sem esperar pelo restock.";
    description.style.opacity = "0.8";
    description.style.marginBottom = "8px";
    manualCard.body.appendChild(description);

    // Buy based on current config
    const buyConfigBtn = ui.btn("🛒 Comprar itens configurados", {
      variant: "primary",
      fullWidth: true,
      onClick: async () => {
        buyConfigBtn.disabled = true;
        buyConfigBtn.textContent = "Comprando...";
        
        try {
          const settings = getAutoBuySettings();
          const result = await ShopService.executeAutoBuy({
            ...settings,
            enabled: true, // Force enabled for manual buy
          });
          
          const totalPurchased = 
            Object.values(result.seedsPurchased).reduce((a, b) => a + b, 0) +
            Object.values(result.eggsPurchased).reduce((a, b) => a + b, 0);
          
          if (totalPurchased > 0) {
            statusText.textContent = `✅ Comprados ${totalPurchased} itens!`;
            statusText.style.color = "#4ade80";
            
            if (settings.playSound) {
              try {
                await audio.notify("shops");
              } catch {}
            }
          } else {
            statusText.textContent = "⚠️ Nenhum item configurado para comprar";
            statusText.style.color = "#fbbf24";
          }
        } catch (error) {
          statusText.textContent = "❌ Erro ao comprar";
          statusText.style.color = "#f87171";
          console.error("[AutoBuy] Manual buy error:", error);
        }
        
        buyConfigBtn.disabled = false;
        buyConfigBtn.textContent = "🛒 Comprar itens configurados";
        
        setTimeout(() => {
          statusText.textContent = "";
        }, 3000);
      },
    });

    manualCard.body.appendChild(buyConfigBtn);

    // Status text
    const statusText = document.createElement("div");
    statusText.style.textAlign = "center";
    statusText.style.fontWeight = "600";
    statusText.style.minHeight = "20px";
    manualCard.body.appendChild(statusText);

    container.appendChild(manualCard.root);

    // Quick buy section
    const quickCard = ui.card("⚡ Compra Rápida", { tone: "muted" });
    quickCard.body.style.display = "flex";
    quickCard.body.style.flexDirection = "column";
    quickCard.body.style.gap = "12px";

    // Item type selector
    const typeRow = document.createElement("div");
    typeRow.style.display = "flex";
    typeRow.style.alignItems = "center";
    typeRow.style.gap = "10px";

    const typeLabel = document.createElement("span");
    typeLabel.textContent = "Tipo:";
    typeLabel.style.fontWeight = "600";

    const typeSelect = ui.select({ width: "120px" });
    const optSeed = document.createElement("option");
    optSeed.value = "seed";
    optSeed.textContent = "Semente";
    const optEgg = document.createElement("option");
    optEgg.value = "egg";
    optEgg.textContent = "Ovo";
    typeSelect.append(optSeed, optEgg);

    typeRow.append(typeLabel, typeSelect);
    quickCard.body.appendChild(typeRow);

    // Item selector
    const itemRow = document.createElement("div");
    itemRow.style.display = "flex";
    itemRow.style.alignItems = "center";
    itemRow.style.gap = "10px";

    const itemLabel = document.createElement("span");
    itemLabel.textContent = "Item:";
    itemLabel.style.fontWeight = "600";

    const itemSelect = ui.select({ width: "160px" });
    
    const updateItemOptions = () => {
      itemSelect.innerHTML = "";
      const items = typeSelect.value === "seed" ? AVAILABLE_SEEDS : AVAILABLE_EGGS;
      for (const item of items) {
        const opt = document.createElement("option");
        opt.value = item;
        opt.textContent = typeSelect.value === "egg" ? getEggDisplayName(item) : item;
        itemSelect.appendChild(opt);
      }
    };
    
    typeSelect.addEventListener("change", updateItemOptions);
    updateItemOptions();

    itemRow.append(itemLabel, itemSelect);
    quickCard.body.appendChild(itemRow);

    // Quantity
    const qtyRow = document.createElement("div");
    qtyRow.style.display = "flex";
    qtyRow.style.alignItems = "center";
    qtyRow.style.gap = "10px";

    const qtyLabel = document.createElement("span");
    qtyLabel.textContent = "Quantidade:";
    qtyLabel.style.fontWeight = "600";

    const qtyInput = ui.inputNumber(1, 9999, 1, 10);

    qtyRow.append(qtyLabel, getInputWrapper(qtyInput));
    quickCard.body.appendChild(qtyRow);

    // Quick buy button
    const quickBuyBtn = ui.btn("⚡ Comprar Agora", {
      variant: "primary",
      fullWidth: true,
      onClick: async () => {
        const type = typeSelect.value;
        const item = itemSelect.value;
        const quantity = parseInt(qtyInput.value, 10) || 1;

        quickBuyBtn.disabled = true;
        quickBuyBtn.textContent = "Comprando...";

        try {
          let purchased = 0;
          if (type === "seed") {
            purchased = await ShopService.purchaseMultipleSeeds(item, quantity);
          } else {
            purchased = await ShopService.purchaseMultipleEggs(item, quantity);
          }

          if (purchased > 0) {
            quickStatusText.textContent = `✅ Comprados ${purchased} ${type === "seed" ? "sementes" : "ovos"}!`;
            quickStatusText.style.color = "#4ade80";
          } else {
            quickStatusText.textContent = "⚠️ Não foi possível comprar";
            quickStatusText.style.color = "#fbbf24";
          }
        } catch (error) {
          quickStatusText.textContent = "❌ Erro ao comprar";
          quickStatusText.style.color = "#f87171";
          console.error("[AutoBuy] Quick buy error:", error);
        }

        quickBuyBtn.disabled = false;
        quickBuyBtn.textContent = "⚡ Comprar Agora";

        setTimeout(() => {
          quickStatusText.textContent = "";
        }, 3000);
      },
    });

    quickCard.body.appendChild(quickBuyBtn);

    // Quick status text
    const quickStatusText = document.createElement("div");
    quickStatusText.style.textAlign = "center";
    quickStatusText.style.fontWeight = "600";
    quickStatusText.style.minHeight = "20px";
    quickCard.body.appendChild(quickStatusText);

    container.appendChild(quickCard.root);

    view.appendChild(container);
  });

  ui.mount(root);
}
