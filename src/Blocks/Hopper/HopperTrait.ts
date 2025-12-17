import { BlockContainer, BlockIdentifier, BlockTrait } from "@serenityjs/core";
import { ContainerType } from "@serenityjs/protocol";

export default class BlockHopperTrait extends BlockTrait {
  public static readonly identifier = "hopper";
  public static readonly types = [BlockIdentifier.Hopper];

  private readonly container = new BlockContainer(this.block, ContainerType.Hopper, 5);


}
