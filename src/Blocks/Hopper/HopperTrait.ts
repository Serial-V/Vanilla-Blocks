import { BlockChestTrait, BlockContainer, BlockDestroyOptions, BlockFacingDirection, BlockIdentifier, BlockInteractionOptions, BlockPlacementOptions, BlockTrait, CardinalDirection, EntityIdentifier, EntityItemStackTrait, FacingDirection, ItemStack, TraitOnTickDetails } from "@serenityjs/core";
import { CompoundTag, IntTag, ListTag, ShortTag } from "@serenityjs/nbt";
import { BlockPosition, ContainerType, Vector3f } from "@serenityjs/protocol";

export default class BlockHopperTrait extends BlockTrait {
  public static readonly identifier = "hopper";
  public static readonly types = [BlockIdentifier.Hopper];

  public static MAX_COOLDOWN = 8;

  private readonly container = new BlockContainer(this.block, ContainerType.Hopper, 5);

  private transferCooldown = 0;
  private dirty = false;

  public onAdd(): void {
    this.transferCooldown = this.block.getStorageEntry<ShortTag>("TransferCooldown")?.valueOf() ?? 0;

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
  }


  public onPlace({ origin }: BlockPlacementOptions): boolean | void {
    if (!origin || !origin.isPlayer()) return;

    const directionTrait = this.block.getTrait(BlockFacingDirection);
    const pitch = Math.ceil(origin.rotation.pitch);

    if (pitch >= 80 || pitch <= -70) {
      return directionTrait.setDirection(FacingDirection.Down);
    }

    const direction = origin.getCardinalDirection();

    switch (direction) {
      case CardinalDirection.North: directionTrait.setDirection(FacingDirection.North); break;
      case CardinalDirection.South: directionTrait.setDirection(FacingDirection.South); break;
      case CardinalDirection.East: directionTrait.setDirection(FacingDirection.East); break;
      case CardinalDirection.West: directionTrait.setDirection(FacingDirection.West); break;
    }
  }

  public onInteract(options: BlockInteractionOptions): boolean | void {
    if (options.cancel || options.placingBlock) return;
    if (!options.origin || options.origin.isSneaking) return;

    this.persistIfDirty();
    this.container.show(options.origin);
  }

  public onTick(_details: TraitOnTickDetails): void {
    for (let i = 0; i < this.container.getSize(); i++) {
      if (this.container.getItem(i)) {
        this.container.updateSlot(i);
        this.dirty = true;
        this.persistIfDirty();
        break;
      }
    }

    if (this.transferCooldown > 0) {
      this.transferCooldown--;
      this.dirty = true;
      this.persistIfDirty();
      return;
    }

    // TODO: Check if the block is receiving Redstone power to "stop" the hopper

    let didTransfer = false;

    if (this.container.emptySlotsCount !== 0) {
      didTransfer = this.pushItem();
    }

    if (!this.container.isFull) {
      const pulled = this.pullItem();
      if (pulled) didTransfer = true;
    }

    if (didTransfer) {
      this.transferCooldown = BlockHopperTrait.MAX_COOLDOWN;
      this.dirty = true;
    }

    this.persistIfDirty();
  }

  private pushItem(): boolean {
    const directionTrait = this.block.getTrait(BlockFacingDirection);
    const direction = directionTrait ? directionTrait.getDirection() : FacingDirection.Down;

    const position = BlockPosition.toVector3f(this.block.position);
    switch (direction) {
      case FacingDirection.Down: position.y--; break;
      case FacingDirection.North: position.z--; break;
      case FacingDirection.South: position.z++; break;
      case FacingDirection.West: position.x--; break;
      case FacingDirection.East: position.x++; break;
    }

    const targetBlock = this.dimension.getBlock(position);
    if (!targetBlock) return false;

    const inventoryTrait = targetBlock.getTrait(BlockChestTrait);
    if (!inventoryTrait) return false;

    const targetContainer = inventoryTrait.container;

    for (let i = 0; i < this.container.getSize(); i++) {
      const item = this.container.getItem(i);
      if (!item) continue;

      for (let j = 0; j < targetContainer.getSize(); j++) {
        const targetItem = targetContainer.getItem(j);

        if (targetItem && targetItem.identifier === item.identifier && targetItem.getStackSize() < targetItem.maxStackSize) {
          targetItem.incrementStack(1);
          item.decrementStack(1);
          this.dirty = true;
          return true;
        }

        if (!targetItem) {
          const updatedItem = new ItemStack(item.identifier, { stackSize: 1 });
          targetContainer.setItem(j, updatedItem);
          item.decrementStack(1);
          this.dirty = true;
          return true;
        }
      }
    }
    return false;
  }

  private pullItem(): boolean {
    const position = BlockPosition.toVector3f(this.block.position);
    position.y += 1;

    const sourceBlock = this.dimension.getBlock(position);

    if (sourceBlock && sourceBlock.identifier !== BlockIdentifier.Air) {
      const inventoryTrait = sourceBlock.getTrait(BlockChestTrait);
      if (!inventoryTrait) return false;

      const sourceContainer = inventoryTrait.container;

      for (let i = 0; i < sourceContainer.getSize(); i++) {
        const item = sourceContainer.getItem(i);
        if (!item) continue;

        for (let j = 0; j < this.container.getSize(); j++) {
          const targetItem = this.container.getItem(j);

          if (targetItem && targetItem.identifier === item.identifier && targetItem.getStackSize() < targetItem.maxStackSize) {
            targetItem.incrementStack(1);
            item.decrementStack(1);
            this.dirty = true;
            return true;
          }

          if (!targetItem) {
            const updatedItem = new ItemStack(item.identifier, { stackSize: 1 });
            this.container.setItem(j, updatedItem);
            item.decrementStack(1);
            this.dirty = true;
            return true;
          }

        }
      }
    }

    const entities = this.dimension.getEntities({ position, maxDistance: 1 });
    for (const entity of entities.filter((entry) => entry.identifier === EntityIdentifier.Item)) {
      if (!entity.position.floor().equals(position.floor())) continue;

      const itemTrait = entity.getTrait(EntityItemStackTrait);
      if (!itemTrait) continue;

      const itemStack = itemTrait.itemStack;
      let remaining = itemStack.getStackSize();

      //Fill existing stacks first
      for (let i = 0; i < this.container.getSize() && remaining > 0; i++) {
        const targetItem = this.container.getItem(i);

        if (targetItem && targetItem.identifier === itemStack.identifier && targetItem.getStackSize() < targetItem.maxStackSize) {
          const space = targetItem.maxStackSize - targetItem.getStackSize();
          const toMove = Math.min(space, remaining);

          targetItem.setStackSize(targetItem.getStackSize() + toMove);
          remaining -= toMove;
        }
      }

      //Place leftovers into empty slots
      for (let i = 0; i < this.container.getSize() && remaining > 0; i++) {
        const targetItem = this.container.getItem(i);

        if (!targetItem) {
          const toPlace = Math.min(itemStack.maxStackSize, remaining);
          this.container.setItem(i, new ItemStack(itemStack.identifier, { stackSize: toPlace }));
          remaining -= toPlace;
        }
      }

      //Only despawn if everything was stored
      if (remaining === 0) {
        entity.despawn();
        this.dirty = true;
        return true;
      }

      itemStack.setStackSize(remaining);
    }

    return false;
  }

  public onBreak(options?: BlockDestroyOptions): void {
    if (!options?.origin || options?.cancel) return;

    const position = BlockPosition.toVector3f(this.block.position);

    position.x += 0.5;
    position.y += 0.5;
    position.z += 0.5;

    // Drop items from container
    for (const item of this.container.storage) {
      if (!item) continue;

      const entity = this.dimension.spawnItem(item, position);

      const vx = Math.random() * 0.6 - 0.35;
      const vy = Math.random() * 0.35;
      const vz = Math.random() * 0.6 - 0.35;

      entity.setMotion(new Vector3f(vx, vy, vz));
    }

    for (let i = 0; i < this.container.getSize(); i++) {
      this.container.storage[i] = null;
    }

    this.block.deleteStorageEntry("Items");
    this.block.deleteStorageEntry("TransferCooldown");
  }

  private persistIfDirty(): void {
    if (!this.dirty) return;

    const items = new ListTag<CompoundTag>();
    for (let i = 0; i < this.container.getSize(); i++) {
      const itemStack = this.container.getItem(i);
      if (!itemStack) continue;

      const storage = itemStack.getStorage();
      storage.add(new IntTag(i, "Slot"));
      items.push(storage);
    }

    this.block.setStorageEntry("Items", items);
    this.block.setStorageEntry("TransferCooldown", new ShortTag(this.transferCooldown, "TransferCooldown"));

    this.dirty = false;
  }
}
