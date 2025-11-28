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
  ui: Menu
) {
  const currentConfig = config || { enabled: false, quantity: 999 };

  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "auto 1fr auto";
  row.style.alignItems = "center";
  row.style.gap = "10px";
  row.style.padding = "8px 12px";
  row.style.borderRadius = "8px";
  row.style.background = currentConfig.enabled 
    ? "rgba(122, 162, 255, 0.1)" 
    : "rgba(255, 255, 255, 0.03)";
  row.style.border = currentConfig.enabled 
    ? "1px solid rgba(122, 162, 255, 0.3)" 
    : "1px solid rgba(255, 255, 255, 0.08)";
  row.style.transition = "background 0.2s ease, border-color 0.2s ease";

  // Checkbox
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = currentConfig.enabled;
  checkbox.className = "qmm-check";
  checkbox.style.transform = "scale(1.2)";

  // Label
  const label = document.createElement("span");
  label.textContent = displayName;
  label.style.fontWeight = "500";
  label.style.color = currentConfig.enabled ? "#e7eef7" : "#b9c3cf";

  // Quantity wrapper
  const qtyWrap = document.createElement("div");
  qtyWrap.style.display = "flex";
  qtyWrap.style.alignItems = "center";
  qtyWrap.style.gap = "6px";

  const qtyLabel = document.createElement("span");
  qtyLabel.textContent = "Qty:";
  qtyLabel.style.opacity = "0.7";
  qtyLabel.style.fontSize = "12px";

  const qtyInput = ui.inputNumber(1, 9999, 1, currentConfig.quantity);
  qtyInput.style.width = "70px";
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
      : "rgba(255, 255, 255, 0.03)";
    row.style.border = newConfig.enabled 
      ? "1px solid rgba(122, 162, 255, 0.3)" 
      : "1px solid rgba(255, 255, 255, 0.08)";
    label.style.color = newConfig.enabled ? "#e7eef7" : "#b9c3cf";
    qtyInput.disabled = !newConfig.enabled;
  };

  checkbox.addEventListener("change", updateConfig);
  qtyInput.addEventListener("change", updateConfig);

  row.append(checkbox, label, qtyWrap);
  container.appendChild(row);
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
    seedsCard.body.style.gap = "8px";

    for (const seedId of AVAILABLE_SEEDS) {
      createItemRow(
        seedsCard.body,
        seedId,
        seedId,
        settings.selectedSeeds[seedId],
        (config) => setSeedConfig(seedId, config),
        ui
      );
    }

    container.appendChild(seedsCard.root);

    // ========== Eggs Section ==========
    const eggsCard = ui.card("🥚 Ovos", { tone: "muted" });
    eggsCard.body.style.display = "flex";
    eggsCard.body.style.flexDirection = "column";
    eggsCard.body.style.gap = "8px";

    for (const eggId of AVAILABLE_EGGS) {
      createItemRow(
        eggsCard.body,
        eggId,
        getEggDisplayName(eggId),
        settings.selectedEggs[eggId],
        (config) => setEggConfig(eggId, config),
        ui
      );
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
