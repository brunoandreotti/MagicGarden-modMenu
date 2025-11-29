// src/services/shop.ts
// Service for purchasing seeds and eggs

import { sendToGame } from "../core/webSocketBridge";
import {
  getAutoBuySettings,
  type AutoBuySettings,
} from "../store/auto-buy";
import { Atoms } from "../store/atoms";

const PURCHASE_DELAY_MS = 100; // Delay between purchases to avoid spam
const DEFAULT_STOCK_FALLBACK = 999; // Default stock value when shop data is unavailable

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get current shop stock for seeds and eggs
 */
async function getShopStock(): Promise<{
  seeds: Record<string, number>;
  eggs: Record<string, number>;
}> {
  try {
    const shopsData = await Atoms.shop.shops.get();
    const seeds: Record<string, number> = {};
    const eggs: Record<string, number> = {};
    
    // Extract seed stock
    if (shopsData?.seed?.inventory && Array.isArray(shopsData.seed.inventory)) {
      for (const item of shopsData.seed.inventory) {
        if (item?.species) {
          // Use initialStock if available, otherwise fallback to default
          const stock = item.initialStock ?? item.stock ?? DEFAULT_STOCK_FALLBACK;
          seeds[item.species] = stock;
        }
      }
    }
    
    // Extract egg stock
    if (shopsData?.egg?.inventory && Array.isArray(shopsData.egg.inventory)) {
      for (const item of shopsData.egg.inventory) {
        if (item?.eggId) {
          // Use initialStock if available, otherwise fallback to default
          const stock = item.initialStock ?? item.stock ?? DEFAULT_STOCK_FALLBACK;
          eggs[item.eggId] = stock;
        }
      }
    }
    
    return { seeds, eggs };
  } catch (error) {
    console.error("[ShopService] Failed to get shop stock:", error);
    return { seeds: {}, eggs: {} };
  }
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

    // Get current shop stock for buyMax feature
    const shopStock = await getShopStock();

    // Purchase configured seeds
    for (const [seedId, config] of Object.entries(autoBuySettings.selectedSeeds)) {
      if (!config.enabled) continue;
      
      let quantityToBuy = config.quantity;
      
      // If buyMax is enabled, get maximum available stock
      if (config.buyMax) {
        const stockAvailable = shopStock.seeds[seedId] ?? 0;
        
        if (stockAvailable === 0) {
          console.log(`[AutoBuy] ${seedId} has buyMax enabled but no stock available`);
          continue;
        }
        
        quantityToBuy = stockAvailable;
        console.log(`[AutoBuy] ${seedId} buyMax enabled, purchasing ${quantityToBuy} units (max stock)`);
      } else {
        console.log(`[AutoBuy] ${seedId} purchasing fixed quantity: ${quantityToBuy} units`);
      }
      
      if (quantityToBuy > 0) {
        const purchased = await this.purchaseMultipleSeeds(seedId, quantityToBuy);
        if (purchased > 0) {
          seedsPurchased[seedId] = purchased;
        }
        await sleep(PURCHASE_DELAY_MS);
      }
    }

    // Purchase configured eggs
    for (const [eggId, config] of Object.entries(autoBuySettings.selectedEggs)) {
      if (!config.enabled) continue;
      
      let quantityToBuy = config.quantity;
      
      // If buyMax is enabled, get maximum available stock
      if (config.buyMax) {
        const stockAvailable = shopStock.eggs[eggId] ?? 0;
        
        if (stockAvailable === 0) {
          console.log(`[AutoBuy] ${eggId} has buyMax enabled but no stock available`);
          continue;
        }
        
        quantityToBuy = stockAvailable;
        console.log(`[AutoBuy] ${eggId} buyMax enabled, purchasing ${quantityToBuy} units (max stock)`);
      } else {
        console.log(`[AutoBuy] ${eggId} purchasing fixed quantity: ${quantityToBuy} units`);
      }
      
      if (quantityToBuy > 0) {
        const purchased = await this.purchaseMultipleEggs(eggId, quantityToBuy);
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
