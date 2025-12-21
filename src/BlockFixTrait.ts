import { BlockIdentifier, BlockTrait, type TraitOnTickDetails } from "@serenityjs/core";
import { UpdateBlockFlagsType, UpdateBlockLayerType, UpdateBlockPacket } from "@serenityjs/protocol";

export class BlockFixTrait extends BlockTrait {
  public static override readonly identifier = "block_fixes";
  public static override readonly types = [
    BlockIdentifier.Chest,
    BlockIdentifier.Furnace,
    BlockIdentifier.BlastFurnace,
    BlockIdentifier.Smoker,
    BlockIdentifier.LitFurnace,
    BlockIdentifier.LitBlastFurnace,
    BlockIdentifier.LitSmoker,
    BlockIdentifier.Hopper
  ];

  private readonly sentTo: Set<bigint> = new Set();

  public override onTick(details: TraitOnTickDetails): void {
    if (details.currentTick % 20n !== 0n) return;

    const block = this.block;
    const dimension = block.dimension;

    for (const player of dimension.getPlayers()) {
      if (this.sentTo.has(player.runtimeId)) continue;

      const air = new UpdateBlockPacket();
      air.position = block.position;
      air.layer = UpdateBlockLayerType.Normal;
      air.flags = UpdateBlockFlagsType.None;
      air.networkBlockId = 0;

      // Create and send the UpdateBlockPacket
      const packet = new UpdateBlockPacket();
      packet.position = block.position;
      packet.layer = UpdateBlockLayerType.Normal;
      packet.flags = UpdateBlockFlagsType.None;
      packet.networkBlockId = block.permutation.networkId;

      player.send(air, packet);
      this.sentTo.add(player.runtimeId);
    }

    for (const runtimeId of Array.from(this.sentTo)) {
      const entity = dimension.getEntity(runtimeId, true);

      if (!entity) {
        this.sentTo.delete(runtimeId);
      }
    }
  }
}