import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Bytes, Contract } from "ethers";
import { ethers, upgrades } from "hardhat";
import * as depositData from "../test_deposit_data.json";
import { NETWORK } from "../lib/env";
const {
  DEPOSIT_CONTRACT_ADDRESS,
  ADDRESSES,
  WETH_ABI,
  NATIVE,
} = require(`../lib/constants/${NETWORK}`);
import { toEthers } from "../lib/utils";

const getNextValidator = () =>
  Object.values(
    (({ pubkey, withdrawal_credentials, signature, deposit_data_root }) => ({
      pubkey,
      withdrawal_credentials,
      signature,
      deposit_data_root,
    }))(depositData.default.pop())
  );

const provider = ethers.provider;

describe("Staking", () => {
  async function deployTest() {
    const [owner, updater, activator, treasury, otherAccount] =
      await ethers.getSigners();
    const Staking = await ethers.getContractFactory("Staking");
    const staking = await upgrades.deployProxy(
      Staking,
      [
        DEPOSIT_CONTRACT_ADDRESS,
        ADDRESSES[NATIVE],
        treasury.address,
        updater.address,
        activator.address,
      ],
      {
        initializer: "initialize",
      }
    );
    await staking.deployed();

    const LiquidUnstakePool = await ethers.getContractFactory(
      "LiquidUnstakePool"
    );
    const liquidUnstakePool = await upgrades.deployProxy(
      LiquidUnstakePool,
      [staking.address, ADDRESSES[NATIVE], treasury.address],
      {
        initializer: "initialize",
      }
    );
    await liquidUnstakePool.deployed();

    const Withdrawal = await ethers.getContractFactory("Withdrawal");
    const withdrawal = await upgrades.deployProxy(Withdrawal, [staking.address], { initializer: "initialize"});
    await withdrawal.deployed();

    await staking.updateWithdrawal(withdrawal.address);
    await staking.updateLiquidPool(liquidUnstakePool.address);
    const wethC = new ethers.Contract(ADDRESSES[NATIVE], WETH_ABI);
    const UPDATER_ROLE = await staking.UPDATER_ROLE();
    const ACTIVATOR_ROLE = await staking.ACTIVATOR_ROLE();

    return {
      staking,
      owner,
      updater,
      activator,
      otherAccount,
      treasury,
      wethC,
      liquidUnstakePool,
      withdrawal,
      UPDATER_ROLE,
      ACTIVATOR_ROLE,
    };
  }

  describe("Deposit", () => {
    var staking: Contract,
      liquidUnstakePool: Contract,
      owner: SignerWithAddress,
      wethC: Contract;

    it("Deposit < 0.01 ETH must revert with minAmount", async () => {
      ({ owner, staking, wethC, liquidUnstakePool } = await loadFixture(
        deployTest
      ));
      let value = toEthers(0.0099);
      await expect(
        staking.depositETH(owner.address, { value })
      ).to.be.revertedWithCustomError(staking, "DepositTooLow");
    });

    it("Deposit < 0.01 wETH must revert with minAmount", async () => {
      let value = toEthers(0.0099);
      await wethC.connect(owner).deposit({ value });
      await wethC.connect(owner).approve(staking.address, value);
      await expect(staking.deposit(value, owner.address)).to.be.revertedWithCustomError(staking, "DepositTooLow");
    });

    it("Deposit ETH", async () => {
      let value = toEthers(32);
      expect(await staking.balanceOf(owner.address)).to.eq(0);
      await staking.depositETH(owner.address, { value });
      expect(await staking.balanceOf(owner.address)).to.eq(value);
      value = toEthers(9.51);
      await staking.depositETH(owner.address, { value });
      expect(await staking.balanceOf(owner.address)).to.eq(toEthers(41.51));
      expect(await provider.getBalance(staking.address)).to.eq(toEthers(41.51));
    });

    it("Deposit WETH", async () => {
      let value = toEthers(4);
      await wethC.connect(owner).deposit({ value });
      await wethC.connect(owner).approve(staking.address, value);
      await staking.deposit(value, owner.address);
      expect(await staking.balanceOf(owner.address)).to.eq(toEthers(45.51));
      value = toEthers(22.49);
      await wethC.connect(owner).deposit({ value });
      await wethC.connect(owner).approve(staking.address, value);
      await staking.deposit(value, owner.address);
      expect(await staking.balanceOf(owner.address)).to.eq(toEthers(68));
    });

    it("Deposit ETH and get mpETH from LiquidUnstakePool", async () => {
      const value = toEthers(2);
      await liquidUnstakePool.depositETH(owner.address, { value });
      await staking.approve(liquidUnstakePool.address, value);
      await liquidUnstakePool.swapmpETHforETH(value, 0);
      const valueMinusFee = toEthers(1.975);
      const poolmpETHBalanceBefore = await staking.balanceOf(
        liquidUnstakePool.address
      );
      expect(poolmpETHBalanceBefore).to.eq(valueMinusFee);
      const mpETHTotalSupplyBefore = await staking.totalSupply();
      await staking.depositETH(owner.address, { value: valueMinusFee });
      expect(await staking.balanceOf(liquidUnstakePool.address)).to.eq(0);
      expect(await staking.totalSupply()).to.eq(mpETHTotalSupplyBefore);
    });

    it("Deposit ETH and get mpETH from LiquidUnstakePool", async () => {
      const value = toEthers(2);
      await liquidUnstakePool.depositETH(owner.address, { value });
      await staking.approve(liquidUnstakePool.address, value);
      await liquidUnstakePool.swapmpETHforETH(value, 0);
      const valueMinusFee = toEthers(1.9766);
      const poolmpETHBalanceBefore = await staking.balanceOf(
        liquidUnstakePool.address
      );
      expect(poolmpETHBalanceBefore).to.eq(valueMinusFee);
      const mpETHTotalSupplyBefore = await staking.totalSupply();
      await staking.depositETH(owner.address, { value: valueMinusFee });
      expect(await staking.balanceOf(liquidUnstakePool.address)).to.eq(0);
      expect(await staking.totalSupply()).to.eq(mpETHTotalSupplyBefore);
    });
  });

  describe("Activate validator", () => {
    var staking: Contract,
      liquidUnstakePool: Contract,
      owner: SignerWithAddress,
      activator: SignerWithAddress,
      otherAccount: SignerWithAddress,
      ACTIVATOR_ROLE: Bytes;

    it("Stake more than owned balance must revert", async () => {
      ({
        owner,
        activator,
        otherAccount,
        staking,
        ACTIVATOR_ROLE,
        liquidUnstakePool,
      } = await loadFixture(deployTest));
      expect(await staking.nodesAndWithdrawalTotalBalance()).to.eq(toEthers(0));
      await expect(
        staking.connect(activator).pushToBeacon([getNextValidator()], 0, 0)
      ).to.be.revertedWithCustomError(staking, "NotEnoughETHtoStake");
    });

    it("Stake without permissions must revert", async () => {
      await expect(
        staking.connect(otherAccount).pushToBeacon([getNextValidator()], 0, 0)
      ).to.be.revertedWith(
        `AccessControl: account ${otherAccount.address.toLowerCase()} is missing role ${ACTIVATOR_ROLE}`
      );
    });

    it("Stake 32 ETH", async () => {
      await staking.depositETH(owner.address, { value: toEthers(32) });
      await staking.connect(activator).pushToBeacon([getNextValidator()], 0, 0);
      expect(await staking.nodesAndWithdrawalTotalBalance()).to.eq(toEthers(32));
      expect(await staking.totalNodesActivated()).to.eq(1);
    });

    it("Stake using half ETH from LiquidUnstakePool", async () => {
      const value = toEthers(32);
      await staking.depositETH(owner.address, { value });
      await liquidUnstakePool.depositETH(owner.address, { value });
      expect(await provider.getBalance(liquidUnstakePool.address)).to.eq(value);
      expect(await liquidUnstakePool.ethBalance()).to.eq(value);
      expect(await staking.stakingBalance()).to.eq(value);
      await staking
        .connect(activator)
        .pushToBeacon([getNextValidator()], value.div(2), 0);
      expect(await provider.getBalance(liquidUnstakePool.address)).to.eq(value.div(2));
      expect(await liquidUnstakePool.ethBalance()).to.eq(value.div(2));
      expect(await staking.stakingBalance()).to.eq(value.div(2));
      expect(await staking.totalNodesActivated()).to.eq(2);
    });

    it("Try to stake using ETH only from must revert with ETH/mpETH proportion", async () => {
      const value = toEthers(32);
      await liquidUnstakePool.depositETH(owner.address, { value });
      expect(await provider.getBalance(liquidUnstakePool.address)).to.eq(toEthers(48));
      expect(await liquidUnstakePool.ethBalance()).to.eq(toEthers(48));
      await expect(
        staking.connect(activator).pushToBeacon([getNextValidator()], value, 0)
      ).to.be.revertedWithCustomError(liquidUnstakePool, "RequestedETHReachMinProportion");
    });

    it("Stake using ETH only from LiquidUnstakePool", async () => {
      const value = toEthers(32);
      const liquidPreviousBalance = await provider.getBalance(liquidUnstakePool.address)
      await liquidUnstakePool.depositETH(owner.address, { value });
      expect(await provider.getBalance(liquidUnstakePool.address)).to.eq(liquidPreviousBalance.add(value));
      expect(await liquidUnstakePool.ethBalance()).to.eq(liquidPreviousBalance.add(value));
      const stakingBalanceBefore = await staking.stakingBalance();
      await staking
        .connect(activator)
        .pushToBeacon([getNextValidator()], value, 0);
      expect(await provider.getBalance(liquidUnstakePool.address)).to.eq(liquidPreviousBalance);
      expect(await liquidUnstakePool.ethBalance()).to.eq(liquidPreviousBalance);
      expect(await staking.stakingBalance()).to.eq(stakingBalanceBefore);
      expect(await staking.totalNodesActivated()).to.eq(3);
    });
  });

  describe("Update nodes balance", () => {
    var staking: Contract,
      owner: SignerWithAddress,
      updater: SignerWithAddress,
      treasury: SignerWithAddress,
      activator: SignerWithAddress,
      UPDATER_ROLE: Bytes;

    const depositValue = BigNumber.from(toEthers(660)),
      newNodes = parseInt(depositValue.div(toEthers(32)).toString()),
      nodesBalance = BigNumber.from(newNodes).mul(toEthers(32)),
      onePercent = BigNumber.from(nodesBalance).mul(10).div(10000),
      newNodesBalance = nodesBalance.add(onePercent);

    it("Update without permissions must revert", async () => {
      ({ owner, updater, activator, staking, UPDATER_ROLE, treasury } =
        await loadFixture(deployTest));
      await staking.depositETH(owner.address, { value: depositValue });
      await staking.connect(activator).pushToBeacon(
        [...Array(newNodes).keys()].map((_) => getNextValidator()),
        0, 0
      );
      expect(await staking.nodesAndWithdrawalTotalBalance()).to.eq(nodesBalance);
      await expect(
        staking.updateNodesBalance(newNodesBalance)
      ).to.be.revertedWith(
        `AccessControl: account ${owner.address.toLowerCase()} is missing role ${UPDATER_ROLE}`
      );
    });

    it("Update balance more than 0.1% must revert", async () => {
      await expect(
        staking.connect(updater).updateNodesBalance(newNodesBalance.add(1))
      ).to.be.revertedWithCustomError(staking, "UpdateTooBig");
    });

    it("Update nodes balance to same amount", async () => {
      expect(await staking.convertToAssets(toEthers(1))).to.eq(toEthers(1));
      await staking.connect(updater).updateNodesBalance(nodesBalance);
      expect(await staking.nodesAndWithdrawalTotalBalance()).to.eq(nodesBalance);
      expect(await staking.totalAssets()).to.eq(depositValue);
      expect(await staking.convertToAssets(toEthers(1))).to.eq(toEthers(1));
    });

    it("Update before timelock must revert", async () => {
      await expect(
        staking.connect(updater).updateNodesBalance(newNodesBalance)
      ).to.be.revertedWithCustomError(staking, "UpdateBalanceTimestampNotReached");
    });

    it("Update nodes balance and mint mpETH for treasury", async () => {
      expect(await staking.convertToAssets(toEthers(1))).to.eq(toEthers(1));
      const timelock = await staking.UPDATE_BALANCE_TIMELOCK();
      await time.increase(timelock);
      const stakingFee = await staking.rewardsFee();
      const expectedFee = onePercent.mul(stakingFee).div(10000);
      await staking.connect(updater).updateNodesBalance(newNodesBalance);
      expect(await staking.balanceOf(treasury.address)).to.eq(expectedFee);
      expect(await staking.nodesAndWithdrawalTotalBalance()).to.eq(newNodesBalance);
      expect(await staking.totalAssets()).to.eq(depositValue.add(onePercent));
    });

    it("Nodes balance grows by estimatedRewardsPerSecond as expected", async () => {
      const [stakingBalance, nodesAndWithdrawalTotalBalance, estimatedRewardsPerSecond] =
        await Promise.all([
          staking.stakingBalance(),
          staking.nodesAndWithdrawalTotalBalance(),
          staking.estimatedRewardsPerSecond(),
        ]);
      let increaseTime = 1;
      await time.increase(increaseTime);
      expect(await staking.totalAssets()).to.eq(
        stakingBalance
          .add(nodesAndWithdrawalTotalBalance)
          .add(estimatedRewardsPerSecond.mul(increaseTime))
      );
      const oneHour = 86400;
      increaseTime += oneHour;
      await time.increase(oneHour);
      expect(await staking.totalAssets()).to.eq(
        stakingBalance
          .add(nodesAndWithdrawalTotalBalance)
          .add(estimatedRewardsPerSecond.mul(increaseTime))
      );
    });
  });

  describe("Withdraw and redeem", () => {
    var staking: Contract, owner: SignerWithAddress;

    it("Withdraw must revert with max withdraw", async () => {
      ({ owner, staking } = await loadFixture(deployTest));
      await expect(
        staking.withdraw(1, owner.address, owner.address)
      ).to.be.revertedWith("ERC4626: withdraw more than max");
    });

    it("Redeem must revert with max redeem", async () => {
      await expect(
        staking.redeem(1, owner.address, owner.address)
      ).to.be.revertedWith("ERC4626: redeem more than max");
    });

    it("Withdraw must not revert", async () => {
      await staking.withdraw(0, owner.address, owner.address);
    });

    it("Redeem must not revert", async () => {
      await staking.redeem(0, owner.address, owner.address);
    });
  });

  describe("Whitelisting", () => {
    var staking: Contract,
      owner: SignerWithAddress

    it("Enable whitelisting", async () => {
      ({ owner, staking } = await loadFixture(
        deployTest
      ));
      expect(await staking.whitelistEnabled()).to.be.false;
      await staking.toggleWhitelistEnabled();
      expect(await staking.whitelistEnabled()).to.be.true;
    });

    it("Revert deposit from non whitelisted", async () => {
      await expect(staking.depositETH(owner.address, { value: toEthers(32) })).to.be.revertedWithCustomError(staking, "UserNotWhitelisted")
    });

    it("Whitelist account and deposit", async () => {
      await staking.addToWhitelist([owner.address]);
      expect(await staking.whitelistedAccounts(owner.address)).to.be.true;
      await staking.depositETH(owner.address, { value: toEthers(32) });
    });

    it("Remove from whitelist", async() => {
      await staking.removeFromWhitelist([owner.address]);
      expect(await staking.whitelistedAccounts(owner.address)).to.be.false;
      await expect(staking.depositETH(owner.address, { value: toEthers(32) })).to.be.revertedWithCustomError(staking, "UserNotWhitelisted")
    });
  })
});
