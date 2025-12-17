import { WorldInitializeSignal } from "@serenityjs/core";
import { Plugin, PluginEvents } from "@serenityjs/plugins";
import BlockBlastFurnaceTrait from "./Blocks/BlastFurnace/BlastFurnaceTrait";
import BlockFurnaceTrait from "./Blocks/Furnace/FurnaceTrait";
import BlockHopperTrait from "./Blocks/Hopper/HopperTrait";
import BlockTraitRegisteration from "./Blocks/index";
import BlockSmokerTrait from "./Blocks/Smoker/SmokerTrait";
import config from "./Lib/config";

export class VanillaBlocksPlugin extends Plugin implements PluginEvents {
  public constructor() {
    super("vanilla-blocks-plugin", "1.0.0");
  }

  public onStartUp(): void {
    this.logger.info("Vanilla-Blocks Plugin has been started up!");
  }

  private getEnabledTraits() {
    return BlockTraitRegisteration.filter((trait) => {
      if (config.disableFurnace && trait instanceof BlockFurnaceTrait) return false;
      if (config.disableBlastFurnace && trait instanceof BlockBlastFurnaceTrait) return false;
      if (config.disableSmoker && trait instanceof BlockSmokerTrait) return false;
      if (config.disableHopper && trait instanceof BlockHopperTrait) return false;

      return true;
    });
  }

  public onInitialize(_plugin: Plugin): void {
    this.logger.info("Vanilla-Blocks Plugin has been loaded!");

    if (this.serenity.getWorld()) {
      for (const trait of this.getEnabledTraits()) {
        this.serenity.getWorld().blockPalette.registerTrait(trait);
      }
    }
  }

  public onShutDown(_plugin: Plugin): void {
    this.logger.info("Vanilla-Blocks Plugin has been unloaded!");

    for (const trait of this.getEnabledTraits()) {
      this.serenity.getWorld().blockPalette.unregisterTrait(trait);
    }
  }

  public beforeWorldInitialize(event: WorldInitializeSignal): boolean {
    const { world } = event;

    for (const trait of this.getEnabledTraits()) {
      world.blockPalette.registerTrait(trait);
    }

    return true;
  }
}

export default new VanillaBlocksPlugin();
export { };

