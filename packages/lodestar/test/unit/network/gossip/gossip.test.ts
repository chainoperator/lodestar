import {Gossip} from "../../../../src/network/gossip/gossip";
import {INetworkOptions} from "../../../../src/network/options";
import {ENR} from "@chainsafe/discv5";
import {createPeerId} from "../../../../src/network";
import {MetadataController} from "../../../../src/network/metadata";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import sinon from "sinon";
import {NodejsNode} from "../../../../src/network/nodejs";
import {GossipMessageValidator} from "../../../../src/network/gossip/validator";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconChain} from "../../../../src/chain";
import {expect} from "chai";
import {GossipEvent} from "../../../../src/network/gossip/constants";
import {getGossipTopic} from "../../../../src/network/gossip/utils";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {IGossipSub} from "../../../../src/network/gossip/interface";
import {MockGossipSub} from "../../../utils/mocks/gossipsub";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain";
import {generateState} from "../../../utils/state";
import {generateEmptySignedBlock} from "../../../utils/block";
import {GossipEncoding} from "../../../../src/network/gossip/encoding";
import {BeaconState} from "@chainsafe/lodestar-types";

describe("Network Gossip", function() {
  let gossip: Gossip;
  let metadata: MetadataController;
  const sandbox = sinon.createSandbox();
  let pubsub: IGossipSub;
  let chain: IBeaconChain;
  let state: BeaconState;

  beforeEach(async () => {
    const networkOpts: INetworkOptions = {
      maxPeers: 0,
      multiaddrs: [],
      bootnodes: [],
      rpcTimeout: 0,
      connectTimeout: 0,
      disconnectTimeout: 0,
    };
    const peerIdB = await createPeerId();
    const enr = ENR.createFromPeerId(peerIdB);
    const libp2p = sandbox.createStubInstance(NodejsNode);
    const logger = new WinstonLogger();
    logger.silent = true;
    const validator = sandbox.createStubInstance(GossipMessageValidator);
    state = generateState();
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: 0n,
      state,
      config
    });
    metadata = new MetadataController({enr}, {config,  chain, logger});
    pubsub = new MockGossipSub();
    gossip = new Gossip(networkOpts, metadata, {config, libp2p, logger, validator, chain, pubsub});
    await gossip.start();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("subscribe/unsubscribe", () => {
    it("should subscribe to attestation subnet correctly", async () => {
      const spy = sandbox.spy();
      const anotherSpy = sandbox.spy();
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, "1", spy);
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, "1", anotherSpy);
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, "2", spy);
      const attestation = generateEmptyAttestation();
      pubsub.emit(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          chain.currentForkDigest,
          GossipEncoding.SSZ_SNAPPY,
          new Map([["subnet", "1"]])
        ),
        attestation
      );
      // should not emit to 2 different subnets
      expect(spy.callCount).to.be.equal(1);
      expect(anotherSpy.callCount).to.be.equal(1);
    });

    it("should unsubscribe to single subnet correctly", async () => {
      const spy = sandbox.spy();
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, "1", spy);
      // should not unsubscribe wrong subnet
      gossip.unsubscribeFromAttestationSubnet(chain.currentForkDigest, "1", spy);
      const attestation = generateEmptyAttestation();
      pubsub.emit(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          chain.currentForkDigest,
          GossipEncoding.SSZ_SNAPPY,
          new Map([["subnet", "1"]])
        ),
        attestation
      );
      pubsub.emit(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          chain.currentForkDigest,
          GossipEncoding.SSZ,
          new Map([["subnet", "1"]])
        ),
        attestation
      );
      expect(spy.callCount).to.be.equal(0);
    });

    it("should unsubscribe across subnets correctly", async () => {
      const spy = sandbox.spy();
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, "1", spy);
      const spy2 = sandbox.spy();
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, "2", spy2);
      // should not unsubscribe wrong subnet
      gossip.unsubscribeFromAttestationSubnet(chain.currentForkDigest, "2", spy2);
      const attestation = generateEmptyAttestation();
      pubsub.emit(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          chain.currentForkDigest,
          GossipEncoding.SSZ_SNAPPY,
          new Map([["subnet", "1"]])
        ),
        attestation
      );
      expect(spy.callCount).to.be.equal(1);
      expect(spy2.callCount).to.be.equal(0);
    });

    it("should subscribe/unsubscribe to block correctly", async () => {
      const spy = sandbox.spy();
      const anotherSpy = sandbox.spy();
      gossip.subscribeToBlock(chain.currentForkDigest, spy);
      gossip.subscribeToBlock(chain.currentForkDigest, anotherSpy);
      const block = generateEmptySignedBlock();
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, chain.currentForkDigest), block);
      expect(spy.callCount).to.be.equal(1);
      expect(anotherSpy.callCount).to.be.equal(1);
      // unsubscribe spy
      gossip.unsubscribe(chain.currentForkDigest, GossipEvent.BLOCK, spy, new Map());
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, chain.currentForkDigest), block);
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, chain.currentForkDigest, GossipEncoding.SSZ), block);
      // still 1
      expect(spy.callCount).to.be.equal(1);
      // 1 more time => 2
      expect(anotherSpy.callCount).to.be.equal(3);
    });

    // other topics are the same

    it("should handle fork digest changed", async () => {
      // fork digest is changed after gossip started
      const oldForkDigest = chain.currentForkDigest;
      state.fork.currentVersion = Buffer.from([100, 0, 0, 0]);
      expect(config.types.ForkDigest.equals(chain.currentForkDigest, oldForkDigest)).to.be.false;
      const received = new Promise((resolve) => {
        gossip.subscribeToBlock(chain.currentForkDigest, resolve);
      });
      chain.emit("forkDigest", chain.currentForkDigest);
      const block = generateEmptySignedBlock();
      pubsub.emit(
        getGossipTopic(GossipEvent.BLOCK, chain.currentForkDigest, GossipEncoding.SSZ_SNAPPY, new Map()),
        block
      );
      await received;
    });
  });

  describe("Metadata", async function() {
    it("subscribeToAttestationSubnet", () => {
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(0);
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, 10);
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(1);
      // subscribe same subnet again, should not change seq number
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, 10);
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(1);
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, 20);
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(2);
    });

    it("unsubscribeFromAttestationSubnet", () => {
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(0);
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, 10);
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(1);
      gossip.subscribeToAttestationSubnet(chain.currentForkDigest, 20);
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(2);
      gossip.unsubscribeFromAttestationSubnet(chain.currentForkDigest, 20);
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(3);
      // unsubscribe same subnet again
      gossip.unsubscribeFromAttestationSubnet(chain.currentForkDigest, 20);
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(3);
      gossip.unsubscribeFromAttestationSubnet(chain.currentForkDigest, 10);
      expect(Number(metadata.seqNumber.valueOf())).to.be.equal(4);
    });
  });

});