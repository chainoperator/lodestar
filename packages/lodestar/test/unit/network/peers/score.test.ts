import {expect} from "chai";
import PeerId from "peer-id";
import {PeerAction, ScoreState, PeerRpcScoreStore} from "../../../../src/network/peers/score";
import {IPeerMetadataStore} from "../../../../src/network/peers";

describe("simple block provider score tracking", function () {
  const peer = PeerId.createFromB58String("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");
  const MIN_SCORE = -100;

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function mockStore() {
    const store: IPeerMetadataStore = {
      encoding: new PeerMap<any>(),
      metadata: new PeerMap<any>(),
      rpcScore: new PeerMap<number>(),
      rpcScoreLastUpdate: new PeerMap<number>(),
    };
    return {store, scoreStore: new PeerRpcScoreStore(store)};
  }

  it("Should return default score, without any previous action", async function () {
    const {scoreStore} = mockStore();
    const score = await scoreStore.getScore(peer);
    expect(score).to.be.equal(0);
  });

  const timesToBan: [PeerAction, number][] = [
    [PeerAction.Fatal, 1],
    [PeerAction.LowToleranceError, 5],
    [PeerAction.MidToleranceError, 10],
    [PeerAction.HighToleranceError, 50],
  ];

  for (const [peerAction, times] of timesToBan)
    it(`Should ban peer after ${times} ${peerAction}`, async () => {
      const {scoreStore} = mockStore();
      for (let i = 0; i < times; i++) await scoreStore.applyAction(peer, peerAction);
      expect(await scoreStore.getScoreState(peer)).to.be.equal(ScoreState.Banned);
    });

  const factorForJsBadMath = 1.1;
  const decayTimes: [number, number][] = [
    // [MinScore, timeToDecay]
    [-50, 10 * 60 * 1000],
    [-25, 20 * 60 * 1000],
    [-5, 40 * 60 * 1000],
  ];
  for (const [minScore, timeToDecay] of decayTimes)
    it(`Should decay MIN_SCORE to ${minScore} after ${timeToDecay} ms`, async () => {
      const {store, scoreStore} = mockStore();
      await store.rpcScore.set(peer, MIN_SCORE);
      await store.rpcScoreLastUpdate.set(peer, Date.now() - timeToDecay * factorForJsBadMath);
      await scoreStore.update(peer);
      expect(await scoreStore.getScore(peer)).to.be.greaterThan(minScore);
    });

  it("should not go belove min score", async function () {
    const {scoreStore} = mockStore();
    await scoreStore.applyAction(peer, PeerAction.Fatal);
    await scoreStore.applyAction(peer, PeerAction.Fatal);
    expect(await scoreStore.getScore(peer)).to.be.gte(MIN_SCORE);
  });
});

class PeerMap<T> {
  map = new Map<string, T>();
  async get(peer: PeerId): Promise<T | undefined> {
    return this.map.get(peer.toB58String());
  }
  async set(peer: PeerId, value: T): Promise<void> {
    this.map.set(peer.toB58String(), value);
  }
}
