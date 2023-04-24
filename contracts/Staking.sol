// SPDX-License-Identifier: MIT
pragma solidity ^0.8;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./IDeposit.sol";
import "./LiquidUnstakePool.sol";
import "./Withdrawal.sol";
import "./IWETH.sol";

/// @title ETH staking manager and mpETH staking token
/// @author MetaPool
/// @notice Stake ETH and get mpETH as the representation of the portion owned through all the validators
/// @dev Implements ERC4626 and adapts some functions to simulate ETH native token as asset instead of an ERC20. Also allows the deposit of WETH
contract Staking is
    Initializable,
    ERC4626Upgradeable,
    AccessControlUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Node {
        bytes pubkey;
        bytes withdrawCredentials;
        bytes signature;
        bytes32 depositDataRoot;
    }

    address public treasury;
    address payable public liquidUnstakePool;
    IDeposit public depositContract;
    uint public nodesTotalBalance;
    uint public stakingBalance;
    uint64 public nodesBalanceUnlockTime;
    uint64 public constant UPDATE_BALANCE_TIMELOCK = 4 hours;
    uint64 public constant MIN_DEPOSIT = 0.01 ether;
    uint64 public estimatedRewardsPerSecond;
    uint32 public totalNodesActivated;
    uint16 public rewardsFee;
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    bytes32 public constant ACTIVATOR_ROLE = keccak256("ACTIVATOR_ROLE");
    address payable public withdrawal;

    event Mint(
        address indexed sender,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event Stake(uint nodeId, bytes indexed pubkey);
    event UpdateNodeData(uint nodeId, Node data);
    event UpdateNodesBalance(uint balance);

    modifier validDeposit(uint _amount) {
        require(_amount >= MIN_DEPOSIT, "Deposit at least 0.01 ETH");
        _;
    }

    function initialize(
        IDeposit _depositContract,
        IERC20MetadataUpgradeable _weth,
        address _treasury,
        address _updater,
        address _activator
    ) external initializer {
        __ERC4626_init(IERC20Upgradeable(_weth));
        __ERC20_init("MetaPoolETH", "mpETH");
        __AccessControl_init();
        require(
            _weth.decimals() == 18,
            "wNative token error, implementation for 18 decimals"
        );
        require(
            address(this).balance == 0,
            "Error initialize with no zero balance"
        );
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPDATER_ROLE, _updater);
        _grantRole(ACTIVATOR_ROLE, _activator);
        updateRewardsFee(500);
        treasury = _treasury;
        depositContract = _depositContract;
        nodesBalanceUnlockTime = uint64(block.timestamp);
    }

    /// @dev Needed to receive ETH from WETH deposits
    receive() external payable {}

    /// @notice Calculate ETH held by vault + validators + estimatedRewards
    /// @return Returns total ETH in the protocol
    /// @dev To a more accurate balance also includes an estimation of the rewards generated by validators since the last updateNodesBalance
    function totalAssets() public view override returns (uint) {
        return
            stakingBalance +
            nodesTotalBalance +
            estimatedRewardsPerSecond *
            (uint64(block.timestamp) -
                (nodesBalanceUnlockTime -
                UPDATE_BALANCE_TIMELOCK));
    }

    /// @notice Update Withdrawal contract address
    /// @dev Admin function
    function updateWithdrawal(address payable _withdrawal)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        withdrawal = _withdrawal;
    }

    /// @notice Update LiquidPool contract address
    /// @dev Admin function
    function updateLiquidPool(address payable _liquidPool)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_liquidPool != address(0), "Invalid address zero");
        liquidUnstakePool = _liquidPool;
    }

    /// @notice Update fee from rewards
    /// @dev Admin function
    function updateRewardsFee(uint16 _rewardsFee)
        public
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        rewardsFee = _rewardsFee;
    }

    /// @notice Update Withdrawal contract address
    /// @dev Updater function
    /// @notice Updates nodes total balance
    function updateNodesBalance(uint _newBalance)
        external
        onlyRole(UPDATER_ROLE)
    {
        uint64 _nodesBalanceUnlockTime = nodesBalanceUnlockTime;
        require(
            block.timestamp > _nodesBalanceUnlockTime,
            "Unlock time not reached"
        );
        uint _nodesTotalBalance = nodesTotalBalance;
        _newBalance += Withdrawal(withdrawal).ethRemaining();
        bool balanceIncremented = _newBalance > _nodesTotalBalance;
        uint diff = balanceIncremented
            ? _newBalance - _nodesTotalBalance
            : _nodesTotalBalance - _newBalance;
        require(
            diff <= _nodesTotalBalance / 1000,
            "Difference greater than 0.1%"
        );

        if (balanceIncremented) {
            uint assetsAsFee = (diff * rewardsFee) / 10000;
            uint shares = previewDeposit(assetsAsFee);
            _mint(treasury, shares);
        }

        estimatedRewardsPerSecond = uint64(
            diff /
                (uint64(block.timestamp) -
                   ( _nodesBalanceUnlockTime -
                    UPDATE_BALANCE_TIMELOCK))
        );
        nodesBalanceUnlockTime =
            uint64(block.timestamp) +
            UPDATE_BALANCE_TIMELOCK;
        nodesTotalBalance = _newBalance;
        emit UpdateNodesBalance(_newBalance);
    }

    /// @notice Stake ETH in contract to validators
    /// @param _nodes Nodes info for staking
    /// @param _requestPoolAmount ETH amount to take from LiquidUnstakePool
    /// @param _requestWithdrawalAmount ETH amount to take from Withdrawal
    function pushToBeacon(Node[] memory _nodes, uint _requestPoolAmount, uint _requestWithdrawalAmount)
        external
        onlyRole(ACTIVATOR_ROLE)
    {
        uint32 nodesLength = uint32(_nodes.length);
        uint requiredBalance = nodesLength * 32 ether;
        require(
            stakingBalance + _requestPoolAmount + _requestWithdrawalAmount >= requiredBalance,
            "Not enough balance"
        );

        if (_requestPoolAmount > 0)
            LiquidUnstakePool(liquidUnstakePool).getEthForValidator(_requestPoolAmount);
        if (_requestWithdrawalAmount > 0)
            Withdrawal(withdrawal).getEthForValidator(_requestWithdrawalAmount);

        uint32 _totalNodesActivated = totalNodesActivated;

        for (uint i = 0; i < nodesLength; i++) {
            depositContract.deposit{value: 32 ether}(
                _nodes[i].pubkey,
                _nodes[i].withdrawCredentials,
                _nodes[i].signature,
                _nodes[i].depositDataRoot
            );
            _totalNodesActivated++;
            emit Stake(_totalNodesActivated, _nodes[i].pubkey);
        }

        uint requiredBalanceFromStaking = requiredBalance - _requestWithdrawalAmount;
        // Amount from Withdrawal isn't included as this amount was never substracted from nodesTotalBalance and never added to stakingBalance
        stakingBalance -= requiredBalanceFromStaking;
        nodesTotalBalance += requiredBalanceFromStaking;
        totalNodesActivated = _totalNodesActivated;
    }

    /// @notice Deposit WETH
    /// @dev Same function as in ERC4626 but removes maxDeposit check and add validDeposit modifier who checks for minDeposit
    function deposit(uint256 _assets, address _receiver)
        public
        override
        validDeposit(_assets)
        returns (uint256)
    {
        uint256 _shares = previewDeposit(_assets);
        _deposit(msg.sender, _receiver, _assets, _shares);
        return _shares;
    }

    /// @notice Deposit ETH
    /// @dev Equivalent to deposit function but for native token. Sends assets 0 to _deposit to indicate that the assets amount will be msg.value
    function depositETH(address _receiver)
        public
        payable
        validDeposit(msg.value)
        returns (uint256)
    {
        uint256 _shares = previewDeposit(msg.value);
        _deposit(msg.sender, _receiver, 0, _shares);
        return _shares;
    }

    /// @notice Confirm ETH or WETH deposit
    /// @dev Use ETH or get and convert WETH to ETH, get mpETH from pool and/or mint new mpETH
    function _deposit(
        address _caller,
        address _receiver,
        uint256 _assets,
        uint256 _shares
    ) internal override {
        if (_assets == 0) { // ETH deposit
            _assets = msg.value;
        } else { // WETH deposit. Get WETH and convert to ETH
            IERC20Upgradeable(asset()).safeTransferFrom(
                msg.sender,
                address(this),
                _assets
            );
            IWETH(asset()).withdraw(_assets);
        }
        uint availableShares;
        uint assetsToPool;

        // Avoid try to get ETH from LiquidPool if this is also the caller bcs LiquidPool.getEthForValidator called on pushToBeacon also calls depositETH
        if (msg.sender != liquidUnstakePool) {
            availableShares = MathUpgradeable.min(
                balanceOf(liquidUnstakePool),
                _shares
            );
        
            if (availableShares > 0) {
                assetsToPool = previewMint(availableShares);
                require(
                    LiquidUnstakePool(liquidUnstakePool).swapETHFormpETH{
                        value: assetsToPool
                    }(_receiver) == availableShares,
                    "Pool _shares transfer error"
                );
                _shares -= availableShares;
                _assets -= assetsToPool;
            }
        }    

        if (_shares > 0) _mint(_receiver, _shares);

        stakingBalance += _assets;
        emit Deposit(_caller, _receiver, _assets + assetsToPool, _shares + availableShares);
    }

    /// @dev Same function as in ERC4626 implementation but instead of transfer assets set pending withdraw on withdrawal contract
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        _burn(owner, shares);
        Withdrawal(withdrawal).requestWithdraw(assets, msg.sender);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }
}
