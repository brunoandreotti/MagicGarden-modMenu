// src/services/shop.ts
// Service for purchasing seeds and eggs

import { sendToGame } from "../core/webSocketBridge";
import {
  getAutoBuySettings,
  type AutoBuySettings,
} from "../store/auto-buy";

const PURCHASE_DELAY_MS = 100; // Delay between purchases to avoid spam

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const ShopService = {
  /**
   * Purchase a single seed
   */
  async purchaseSeed(species: string): Promise<boolean> {
    try {
      sendToGame({ type: "PurchaseSeed", species });
      return true;
    } catch (error) {
      console.error("[ShopService] Failed to purchase seed:", error);
      return false;
    }
  },

  /**
   * Purchase a single egg
   */
  async purchaseEgg(eggId: string): Promise<boolean> {
    try {
      sendToGame({ type: "PurchaseEgg", eggId });
      return true;
    } catch (error) {
      console.error("[ShopService] Failed to purchase egg:", error);
      return false;
    }
  },

  /**
   * Purchase multiple seeds with delay between each
   */
  async purchaseMultipleSeeds(species: string, quantity: number): Promise<number> {
    let purchased = 0;
    for (let i = 0; i < quantity; i++) {
      const success = await this.purchaseSeed(species);
      if (success) {
        purchased++;
      }
      if (i < quantity - 1) {
        await sleep(PURCHASE_DELAY_MS);
      }
    }
    return purchased;
  },

  /**
   * Purchase multiple eggs with delay between each
   */
  async purchaseMultipleEggs(eggId: string, quantity: number): Promise<number> {
    let purchased = 0;
    for (let i = 0; i < quantity; i++) {
      const success = await this.purchaseEgg(eggId);
      if (success) {
        purchased++;
      }
      if (i < quantity - 1) {
        await sleep(PURCHASE_DELAY_MS);
      }
    }
    return purchased;
  },

  /**
   * Execute auto-buy based on current settings
   * Called when restock is detected
   */
  async executeAutoBuy(settings?: AutoBuySettings): Promise<{
    seedsPurchased: Record<string, number>;
    eggsPurchased: Record<string, number>;
  }> {
    const autoBuySettings = settings ?? getAutoBuySettings();
    
    if (!autoBuySettings.enabled) {
      return { seedsPurchased: {}, eggsPurchased: {} };
    }

    const seedsPurchased: Record<string, number> = {};
    const eggsPurchased: Record<string, number> = {};

    // Purchase configured seeds
    for (const [seedId, config] of Object.entries(autoBuySettings.selectedSeeds)) {
      if (config.enabled && config.quantity > 0) {
        const purchased = await this.purchaseMultipleSeeds(seedId, config.quantity);
        if (purchased > 0) {
          seedsPurchased[seedId] = purchased;
        }
        await sleep(PURCHASE_DELAY_MS);
      }
    }

    // Purchase configured eggs
    for (const [eggId, config] of Object.entries(autoBuySettings.selectedEggs)) {
      if (config.enabled && config.quantity > 0) {
        const purchased = await this.purchaseMultipleEggs(eggId, config.quantity);
        if (purchased > 0) {
          eggsPurchased[eggId] = purchased;
        }
        await sleep(PURCHASE_DELAY_MS);
      }
    }

    console.log("[AutoBuy] Purchase complete:", { seedsPurchased, eggsPurchased });
    
    return { seedsPurchased, eggsPurchased };
  },
};
