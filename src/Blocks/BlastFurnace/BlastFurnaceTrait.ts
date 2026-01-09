import { BlockContainer, BlockDestroyOptions, BlockIdentifier, BlockInteractionOptions, BlockTrait, ItemIdentifier, ItemStack, TraitOnTickDetails } from "@serenityjs/core";
import { CompoundTag, IntTag, ListTag, ShortTag } from "@serenityjs/nbt";
import { BlockPosition, ContainerDataType, ContainerSetDataPacket, ContainerType, UpdateBlockFlagsType, UpdateBlockLayerType, UpdateBlockPacket, Vector3f } from "@serenityjs/protocol";
import fuelTypes from "../../Lib/fuelTypes";
import smeltableTypes from "../../Lib/smeltableTypes";

export default class BlockBlastFurnaceTrait extends BlockTrait {
  public static readonly identifier = "blast_furnace";
  public static readonly types = [BlockIdentifier.BlastFurnace, BlockIdentifier.LitBlastFurnace];

  public static MAX_COOKTIME = 100;
  public static MAX_BURNDURATION = 1600;
  public static MAX_BURNTIME = 1600;

  private readonly container = new BlockContainer(this.block, ContainerType.BlastFurnace, 3);

  private cookTime = 0; // FurnaceTickCount
  private burnDuration = 0; // FurnaceLitDuration
  private burnTime = 0; // FurnaceLitTime

  private dirty = false;

  /**
   * Called when the block is added to the world.
   * Loads the cook time, burn duration, and burn time from leveldb.
   * Also loads the items in the container from leveldb.
   * 
   * This also loads the data when a trait gets added to the furnace
   */
  public onAdd(): void {
    this.cookTime = this.block.getStorageEntry<ShortTag>("CookTime")?.valueOf() ?? 0;
    this.burnDuration = this.block.getStorageEntry<ShortTag>("BurnDuration")?.valueOf() ?? 0;
    this.burnTime = this.block.getStorageEntry<ShortTag>("BurnTime")?.valueOf() ?? 0;

    if (this.block.hasStorageEntry("Items")) {

      const items = this.block.getStorageEntry<ListTag<CompoundTag>>("Items");
      const world = this.block.world;

      for (const storage of items?.values() ?? []) {
        try {
          const itemStack = ItemStack.fromLevelStorage(world, storage);
          const slot = Number(storage.get("Slot")?.valueOf() ?? 0);
          this.container.setItem(slot, itemStack);
        } catch { }
      }
    } else {
      this.block.addStorageEntry(new ListTag<CompoundTag>([], "Items"));
    }

    // TODO: load xp in the furnace container from leveldb
  }

  public onInteract(options: BlockInteractionOptions): boolean | void {
    if (options.cancel || options.placingBlock) return;
    if (!options.origin || options.origin.isSneaking) return;

    this.persistIfDirty();
    this.container.show(options.origin);
  }

  /**
   * Called every tick to update the furnace's state.
   *
   * This function checks if the furnace has an ingredient and fuel, and if so, it will update the furnace's state accordingly.
   * If the furnace has no ingredient or fuel, it will reset the furnace's state.
   *
   * This function also handles the cooking of the ingredient, and when the ingredient is done, it will place the output in the output slot.
   */
  public onTick(_details: TraitOnTickDetails): void {
    const ingredient = this.container.getItem(0); // Input slot
    const fuel = this.container.getItem(1); // Fuel slot
    const output = this.container.getItem(2); // Output slot

    if (this.burnTime < 0) this.burnTime = 0;

    const smeltable = ingredient ? smeltableTypes.slice(0, 21).find((entry) => entry.input === ingredient.identifier) : undefined;
    const fuelEntry = fuel ? fuelTypes.find((entry) => entry.identifier === fuel.identifier) : undefined;

    if (!ingredient || !smeltable) {
      if (this.cookTime !== 0) {
        this.cookTime = 0;
        this.dirty = true;
      }

      this.setLit(false);
      this.tickBurn();
      this.persistIfDirty();
      this.sendUI();
      return;
    }

    if (fuelEntry && this.burnTime <= 0) {
      this.burnTime = fuelEntry.burnTime;
      this.burnDuration = fuelEntry.burnTime;
      this.dirty = true;

      if (fuel?.identifier === ItemIdentifier.LavaBucket) {
        this.container.removeItem(1, 1);
        this.container.setItem(1, new ItemStack(ItemIdentifier.Bucket, { auxiliary: 0, stackSize: 1 }));
      } else {
        this.container.removeItem(1, 1);
      }
    }

    const burning = this.burnTime > 0;
    this.setLit(burning);

    if (burning) {
      this.cookTime += 2;
      this.dirty = true;
    }

    this.tickBurn();

    if (this.cookTime >= BlockBlastFurnaceTrait.MAX_COOKTIME) {
      this.cookTime = 0;
      this.dirty = true;

      const canPlace = !output || (output.identifier === smeltable.output && output.getStackSize() < output.maxStackSize);

      if (canPlace) {
        this.container.removeItem(0, 1);
        if (!output) {
          this.container.setItem(2, new ItemStack(smeltable.output, { stackSize: 1 }));
        } else {
          output.incrementStack(1);
        }
      }
    }

    this.persistIfDirty();
    if (this.container.occupants.size === 0) return;
    this.sendUI();
  }

  /**
   * Called when the block is destroyed.
   * Drops all items in the container and removes the storage entries.
   */
  public onBreak(options?: BlockDestroyOptions): void {
    if (!options?.origin || options?.cancel) return;

    const position = BlockPosition.toVector3f(this.block.position);

    position.x += 0.5;
    position.y += 0.5;
    position.z += 0.5;

    for (const item of this.container.storage) {
      if (!item) continue;

      const entity = this.dimension.spawnItem(item, position);

      const vx = Math.random() * 0.6 - 0.35;
      const vy = Math.random() * 0.35;
      const vz = Math.random() * 0.6 - 0.35;

      entity.setMotion(new Vector3f(vx, vy, vz));
    }

    for (let i = 0; i < this.container.size; i++) {
      this.container.storage[i] = null;
    }

    this.block.deleteStorageEntry("Items");
    this.block.deleteStorageEntry("CookTime");
    this.block.deleteStorageEntry("BurnDuration");
    this.block.deleteStorageEntry("BurnTime");
  }

  /**
   * Decrements the burn time of the furnace and updates its lit state
   */
  private tickBurn(): void {
    if (this.burnTime > 0) {
      this.burnTime--;
      this.dirty = true;
      this.setLit(true);
    } else if (this.burnDuration !== 0) {
      this.burnDuration = 0;
      this.cookTime--;
      this.dirty = true;
      this.setLit(false);
    }
  }

  /**
   * Sends the current furnace state to all players occupying the container
   */
  private sendUI(): void {
    if (this.container.occupants.size === 0) return;

    for (const [player, id] of this.container.occupants) {
      const p1 = new ContainerSetDataPacket();
      p1.containerId = id;
      p1.type = ContainerDataType.FurnaceTickCount;
      p1.value = this.cookTime;

      const p2 = new ContainerSetDataPacket();
      p2.containerId = id;
      p2.type = ContainerDataType.FurnaceLitTime;
      p2.value = this.burnTime;

      const p3 = new ContainerSetDataPacket();
      p3.containerId = id;
      p3.type = ContainerDataType.FurnaceLitDuration;
      p3.value = this.burnDuration;

      player.send(p1, p2, p3);
    }
  }

  /**
   * Sets the lit state of the furnace block and broadcasts the update to all clients
   * @param {boolean} lit Whether the furnace should be lit
   */
  private setLit(lit: boolean): void {
    const permutation = lit
      ? this.dimension.world.blockPalette.resolvePermutation(BlockIdentifier.LitBlastFurnace, this.block.permutation.state as any)
      : this.dimension.world.blockPalette.resolvePermutation(BlockIdentifier.BlastFurnace, this.block.permutation.state as any);

    const packet = new UpdateBlockPacket();
    packet.position = this.block.position;
    packet.layer = UpdateBlockLayerType.Normal;
    packet.flags = UpdateBlockFlagsType.None;
    packet.networkBlockId = permutation.networkId;

    this.dimension.broadcast(packet);
  }

  /**
   * Persist the container data to the block leveldb.
   * Only writes to leveldb if this.dirty is true.
   */
  private persistIfDirty(): void {
    if (!this.dirty) return;

    const items = new ListTag<CompoundTag>();
    for (let i = 0; i < this.container.size; i++) {
      const itemStack = this.container.getItem(i);
      if (!itemStack) continue;
      const storage = itemStack.getStorage();
      storage.add(new IntTag(i, "Slot"));
      items.push(storage);
    }

    this.block.setStorageEntry("Items", items);
    this.block.setStorageEntry("CookTime", new ShortTag(this.cookTime, "CookTime"));
    this.block.setStorageEntry("BurnDuration", new ShortTag(this.burnDuration, "BurnDuration"));
    this.block.setStorageEntry("BurnTime", new ShortTag(this.burnTime, "BurnTime"));

    this.dirty = false;
  }
}