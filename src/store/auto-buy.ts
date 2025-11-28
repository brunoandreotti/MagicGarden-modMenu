// src/store/auto-buy.ts
// Store for Auto-Buy settings and state management

const STORAGE_KEY = "mg_autobuy_settings";
const DEFAULT_QUANTITY = 20;

export interface AutoBuyItemConfig {
  enabled: boolean;
  quantity: number;
  buyMax: boolean;
}

export interface AutoBuySettings {
  enabled: boolean;
  playSound: boolean;
  selectedSeeds: Record<string, AutoBuyItemConfig>;
  selectedEggs: Record<string, AutoBuyItemConfig>;
}

// Note: AVAILABLE_SEEDS and AVAILABLE_EGGS have been removed.
// Items are now fetched dynamically from NotifierService which reads
// from the game's shop data (Atoms.shop.shops). This ensures:
// - No hardcoded items that don't exist in the game
// - No missing items that exist in the game
// - Automatic updates when new items are added

function getDefaultSettings(): AutoBuySettings {
  return {
    enabled: false,
    playSound: true,
    selectedSeeds: {},
    selectedEggs: {},
  };
}

export function loadAutoBuySettings(): AutoBuySettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      
      // Migration: add buyMax=false for old configs and new default quantity
      const migrateConfig = (config: any): AutoBuyItemConfig => ({
        enabled: config.enabled ?? false,
        quantity: config.quantity ?? DEFAULT_QUANTITY,
        buyMax: config.buyMax ?? false,
      });
      
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
        playSound: typeof parsed.playSound === "boolean" ? parsed.playSound : true,
        selectedSeeds: parsed.selectedSeeds && typeof parsed.selectedSeeds === "object"
          ? Object.fromEntries(
              Object.entries(parsed.selectedSeeds).map(([id, cfg]) => [
                id,
                migrateConfig(cfg),
              ])
            )
          : {},
        selectedEggs: parsed.selectedEggs && typeof parsed.selectedEggs === "object"
          ? Object.fromEntries(
              Object.entries(parsed.selectedEggs).map(([id, cfg]) => [
                id,
                migrateConfig(cfg),
              ])
            )
          : {},
      };
    }
  } catch (error) {
    console.error("[AutoBuy] Failed to load settings:", error);
  }
  return getDefaultSettings();
}

export function saveAutoBuySettings(settings: AutoBuySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("[AutoBuy] Failed to save settings:", error);
  }
}

type SettingsChangeListener = (settings: AutoBuySettings) => void;
const listeners: Set<SettingsChangeListener> = new Set();

let currentSettings: AutoBuySettings = loadAutoBuySettings();

export function getAutoBuySettings(): AutoBuySettings {
  return currentSettings;
}

export function setAutoBuySettings(settings: AutoBuySettings): void {
  currentSettings = settings;
  saveAutoBuySettings(settings);
  notifyListeners();
}

export function updateAutoBuySettings(partial: Partial<AutoBuySettings>): void {
  currentSettings = { ...currentSettings, ...partial };
  saveAutoBuySettings(currentSettings);
  notifyListeners();
}

export function setSeedConfig(seedId: string, config: AutoBuyItemConfig): void {
  currentSettings = {
    ...currentSettings,
    selectedSeeds: {
      ...currentSettings.selectedSeeds,
      [seedId]: config,
    },
  };
  saveAutoBuySettings(currentSettings);
  notifyListeners();
}

export function setEggConfig(eggId: string, config: AutoBuyItemConfig): void {
  currentSettings = {
    ...currentSettings,
    selectedEggs: {
      ...currentSettings.selectedEggs,
      [eggId]: config,
    },
  };
  saveAutoBuySettings(currentSettings);
  notifyListeners();
}

export function onAutoBuySettingsChange(listener: SettingsChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(currentSettings);
    } catch (error) {
      console.error("[AutoBuy] Listener error:", error);
    }
  }
}
