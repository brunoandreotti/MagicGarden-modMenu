// src/store/auto-buy.ts
// Store for Auto-Buy settings and state management

const STORAGE_KEY = "mg_autobuy_settings";

export interface AutoBuyItemConfig {
  enabled: boolean;
  quantity: number;
}

export interface AutoBuySettings {
  enabled: boolean;
  playSound: boolean;
  selectedSeeds: Record<string, AutoBuyItemConfig>;
  selectedEggs: Record<string, AutoBuyItemConfig>;
}

export const AVAILABLE_SEEDS = [
  "Carrot",
  "Sunflower",
  "Wheat",
  "Corn",
  "Pepper",
  "Lychee",
  "Starweaver",
  "Moonbinder",
  "Dawnbinder",
  "Strawberry",
  "Tomato",
  "Pumpkin",
  "Watermelon",
  "Blueberry",
  "Tulip",
  "Marigold",
  "Coconut",
  "Banana",
  "Sakura",
  "Mushroom",
  "Cactus",
  "Bamboo",
  "Grape",
  "Lemon",
  "Mango",
  "Dragonfruit",
  "Cherry",
] as const;

export const AVAILABLE_EGGS = [
  "CommonEgg",
  "UncommonEgg",
  "RareEgg",
  "EpicEgg",
  "LegendaryEgg",
  "MythicalEgg",
] as const;

export type SeedType = typeof AVAILABLE_SEEDS[number] | string;
export type EggType = typeof AVAILABLE_EGGS[number] | string;

const EGG_DISPLAY_NAMES: Record<string, string> = {
  CommonEgg: "Common Egg",
  UncommonEgg: "Uncommon Egg",
  RareEgg: "Rare Egg",
  EpicEgg: "Epic Egg",
  LegendaryEgg: "Legendary Egg",
  MythicalEgg: "Mythical Egg",
};

export function getEggDisplayName(eggId: string): string {
  return EGG_DISPLAY_NAMES[eggId] || eggId;
}

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
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
        playSound: typeof parsed.playSound === "boolean" ? parsed.playSound : true,
        selectedSeeds: parsed.selectedSeeds && typeof parsed.selectedSeeds === "object"
          ? parsed.selectedSeeds
          : {},
        selectedEggs: parsed.selectedEggs && typeof parsed.selectedEggs === "object"
          ? parsed.selectedEggs
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
