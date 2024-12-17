pragma experimental ABIEncoderV2;
pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./Proxyable.sol";
import "./LimitedSetup.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/IFeePool.sol";

// Libraries
import "./SafeDecimalMath.sol";

import "@chainlink/contracts-0.0.10/src/v0.5/interfaces/AggregatorV2V3Interface.sol";

// Internal references
import "./interfaces/IERC20.sol";
import "./interfaces/IPynth.sol";
import "./interfaces/ISystemStatus.sol";
// import "./interfaces/IPeriFinance.sol";
import "./interfaces/IPeriFinanceDebtShare.sol";
import "./FeePoolEternalStorage.sol";
import "./interfaces/IExchanger.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/IPeriFinanceState.sol";
import "./interfaces/IRewardEscrowV2.sol";
import "./interfaces/IDelegateApprovals.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/IEtherCollateralpUSD.sol";
import "./interfaces/ICollateralManager.sol";
import "./interfaces/ICrossChainManager.sol";
import "./interfaces/IEtherWrapper.sol";
import "./interfaces/IFuturesMarketManager.sol";
import "./interfaces/IWrapperFactory.sol";
import "./interfaces/IPeriFinanceBridgeToOptimism.sol";

// https://docs.peri.finance/contracts/source/contracts/feepool
contract FeePool is Owned, Proxyable, LimitedSetup, MixinSystemSettings, IFeePool {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    bytes32 public constant CONTRACT_NAME = "FeePool";

    // Where fees are pooled in pUSD.
    address public constant FEE_ADDRESS = 0xfeEFEEfeefEeFeefEEFEEfEeFeefEEFeeFEEFEeF;

    // pUSD currencyKey. Fees stored and paid in pUSD
    bytes32 private pUSD = "pUSD";

    // This struct represents the issuance activity that's happened in a fee period.
    struct FeePeriod {
        uint64 feePeriodId;
        //uint64 startingDebtIndex;
        uint64 startTime;
        uint allNetworksSnxBackedDebt;
        uint allNetworksDebtSharesSupply;
        uint feesToDistribute;
        uint feesClaimed;
        uint rewardsToDistribute;
        uint rewardsClaimed;
    }

    // A staker(mintr) can claim from the previous fee period (7 days) only.
    // Fee Periods stored and managed from [0], such that [0] is always
    // the current active fee period which is not claimable until the
    // public function closeCurrentFeePeriod() is called closing the
    // current weeks collected fees. [1] is last weeks feeperiod
    uint8 public constant FEE_PERIOD_LENGTH = 2;

    FeePeriod[FEE_PERIOD_LENGTH] private _recentFeePeriods;
    uint256 private _currentFeePeriod;
    bool private _everDistributedFeeRewards;
    // bool private _everAllocatedFeeRewards;
    uint256 private _feeRewardsToBeAllocated;

    uint256 public quotaTolerance;

    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_SYSTEMSTATUS = "SystemStatus";
    // bytes32 private constant CONTRACT_PERIFINANCE = "PeriFinance";
    bytes32 private constant CONTRACT_PERIFINANCEDEBTSHARE = "PeriFinanceDebtShare";
    bytes32 private constant CONTRACT_FEEPOOLETERNALSTORAGE = "FeePoolEternalStorage";
    bytes32 private constant CONTRACT_EXCHANGER = "Exchanger";
    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_PERIFINANCESTATE = "PeriFinanceState";
    bytes32 private constant CONTRACT_REWARDESCROW_V2 = "RewardEscrowV2";
    bytes32 private constant CONTRACT_DELEGATEAPPROVALS = "DelegateApprovals";
    bytes32 private constant CONTRACT_ETH_COLLATERAL_PUSD = "EtherCollateralpUSD";
    bytes32 private constant CONTRACT_COLLATERALMANAGER = "CollateralManager";
    bytes32 private constant CONTRACT_REWARDSDISTRIBUTION = "RewardsDistribution";
    bytes32 private constant CONTRACT_CROSSCHAINMANAGER = "CrossChainManager";
    bytes32 private constant CONTRACT_ETHER_WRAPPER = "EtherWrapper";
    bytes32 private constant CONTRACT_FUTURES_MARKET_MANAGER = "FuturesMarketManager";
    bytes32 private constant CONTRACT_WRAPPER_FACTORY = "WrapperFactory";

    bytes32 private constant CONTRACT_PERIFINANCE_BRIDGE_TO_OPTIMISM = "PeriFinanceBridgeToOptimism";
    bytes32 private constant CONTRACT_PERIFINANCE_BRIDGE_TO_BASE = "PeriFinanceBridgeToBase";

    bytes32 private constant CONTRACT_EXT_AGGREGATOR_ISSUED_PYNTHS = "ext:AggregatorIssuedPynths";
    bytes32 private constant CONTRACT_EXT_AGGREGATOR_DEBT_RATIO = "ext:AggregatorDebtRatio";

    /* ========== ETERNAL STORAGE CONSTANTS ========== */

    bytes32 private constant LAST_FEE_WITHDRAWAL = "last_fee_withdrawal";

    constructor(
        address payable _proxy,
        address _owner,
        address _resolver
    ) public Owned(_owner) Proxyable(_proxy) LimitedSetup(3 weeks) MixinSystemSettings(_resolver) {
        // Set our initial fee period
        _recentFeePeriodsStorage(0).feePeriodId = 1;
        _recentFeePeriodsStorage(0).startTime = uint64(now);
    }

    /* ========== VIEWS ========== */
    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](17);
        newAddresses[0] = CONTRACT_SYSTEMSTATUS;
        // newAddresses[1] = CONTRACT_PERIFINANCE;
        newAddresses[1] = CONTRACT_PERIFINANCEDEBTSHARE;
        newAddresses[2] = CONTRACT_FEEPOOLETERNALSTORAGE;
        newAddresses[3] = CONTRACT_EXCHANGER;
        newAddresses[4] = CONTRACT_ISSUER;
        newAddresses[5] = CONTRACT_PERIFINANCESTATE;
        newAddresses[6] = CONTRACT_REWARDESCROW_V2;
        newAddresses[7] = CONTRACT_DELEGATEAPPROVALS;
        newAddresses[8] = CONTRACT_ETH_COLLATERAL_PUSD;
        newAddresses[9] = CONTRACT_REWARDSDISTRIBUTION;
        newAddresses[10] = CONTRACT_COLLATERALMANAGER;
        newAddresses[11] = CONTRACT_CROSSCHAINMANAGER;
        newAddresses[12] = CONTRACT_WRAPPER_FACTORY;
        newAddresses[13] = CONTRACT_ETHER_WRAPPER;
        newAddresses[14] = CONTRACT_EXT_AGGREGATOR_ISSUED_PYNTHS;
        newAddresses[15] = CONTRACT_EXT_AGGREGATOR_DEBT_RATIO;
        newAddresses[16] = CONTRACT_FUTURES_MARKET_MANAGER;
        addresses = combineArrays(existingAddresses, newAddresses);
    }

    function systemStatus() internal view returns (ISystemStatus) {
        return ISystemStatus(requireAndGetAddress(CONTRACT_SYSTEMSTATUS));
    }

    // function periFinanceDebtShare() internal view returns (IPeriFinanceDebtShare) {
    //     return IPeriFinanceDebtShare(requireAndGetAddress(CONTRACT_PERIFINANCEDEBTSHARE));
    // }

    function periFinanceDebtShare() internal view returns (IPeriFinanceDebtShare) {
        return IPeriFinanceDebtShare(requireAndGetAddress(CONTRACT_PERIFINANCEDEBTSHARE));
    }

    function feePoolEternalStorage() internal view returns (FeePoolEternalStorage) {
        return FeePoolEternalStorage(requireAndGetAddress(CONTRACT_FEEPOOLETERNALSTORAGE));
    }

    function exchanger() internal view returns (IExchanger) {
        return IExchanger(requireAndGetAddress(CONTRACT_EXCHANGER));
    }

    function etherCollateralpUSD() internal view returns (IEtherCollateralpUSD) {
        return IEtherCollateralpUSD(requireAndGetAddress(CONTRACT_ETH_COLLATERAL_PUSD));
    }

    function collateralManager() internal view returns (ICollateralManager) {
        return ICollateralManager(requireAndGetAddress(CONTRACT_COLLATERALMANAGER));
    }

    function crossChainManager() internal view returns (ICrossChainManager) {
        return ICrossChainManager(requireAndGetAddress(CONTRACT_CROSSCHAINMANAGER));
    }

    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function periFinanceState() internal view returns (IPeriFinanceState) {
        return IPeriFinanceState(requireAndGetAddress(CONTRACT_PERIFINANCESTATE));
    }

    function rewardEscrowV2() internal view returns (IRewardEscrowV2) {
        return IRewardEscrowV2(requireAndGetAddress(CONTRACT_REWARDESCROW_V2));
    }

    function delegateApprovals() internal view returns (IDelegateApprovals) {
        return IDelegateApprovals(requireAndGetAddress(CONTRACT_DELEGATEAPPROVALS));
    }

    function rewardsDistribution() internal view returns (IRewardsDistribution) {
        return IRewardsDistribution(requireAndGetAddress(CONTRACT_REWARDSDISTRIBUTION));
    }

    function etherWrapper() internal view returns (IEtherWrapper) {
        return IEtherWrapper(requireAndGetAddress(CONTRACT_ETHER_WRAPPER));
    }

    function futuresMarketManager() internal view returns (IFuturesMarketManager) {
        return IFuturesMarketManager(requireAndGetAddress(CONTRACT_FUTURES_MARKET_MANAGER));
    }

    function wrapperFactory() internal view returns (IWrapperFactory) {
        return IWrapperFactory(requireAndGetAddress(CONTRACT_WRAPPER_FACTORY));
    }

    function issuanceRatio() external view returns (uint) {
        return getIssuanceRatio();
    }

    function feePeriodDuration() external view returns (uint) {
        return getFeePeriodDuration();
    }

    function targetThreshold() external view returns (uint) {
        return getTargetThreshold();
    }

    function allNetworksSnxBackedDebt() public view returns (uint256 debt, uint256 updatedAt) {
        (, int256 rawData, , uint timestamp, ) =
            AggregatorV2V3Interface(requireAndGetAddress(CONTRACT_EXT_AGGREGATOR_ISSUED_PYNTHS)).latestRoundData();

        debt = uint(rawData);
        updatedAt = timestamp;
    }

    function allNetworksDebtSharesSupply() public view returns (uint256 sharesSupply, uint256 updatedAt) {
        (, int256 rawIssuedPynths, , uint issuedPynthsUpdatedAt, ) =
            AggregatorV2V3Interface(requireAndGetAddress(CONTRACT_EXT_AGGREGATOR_ISSUED_PYNTHS)).latestRoundData();

        (, int256 rawRatio, , uint ratioUpdatedAt, ) =
            AggregatorV2V3Interface(requireAndGetAddress(CONTRACT_EXT_AGGREGATOR_DEBT_RATIO)).latestRoundData();

        uint debt = uint(rawIssuedPynths);
        sharesSupply = rawRatio == 0 ? 0 : debt.divideDecimalRoundPrecise(uint(rawRatio));
        updatedAt = issuedPynthsUpdatedAt < ratioUpdatedAt ? issuedPynthsUpdatedAt : ratioUpdatedAt;
    }

    function recentFeePeriods(uint index)
        external
        view
        returns (
            uint64 feePeriodId,
            //uint64 startingDebtIndex,
            uint64 startTime,
            uint feesToDistribute,
            uint feesClaimed,
            uint rewardsToDistribute,
            uint rewardsClaimed
        )
    {
        FeePeriod memory feePeriod = _recentFeePeriodsStorage(index);
        return (
            feePeriod.feePeriodId,
            //feePeriod.startingDebtIndex,
            feePeriod.startTime,
            feePeriod.feesToDistribute,
            feePeriod.feesClaimed,
            feePeriod.rewardsToDistribute,
            feePeriod.rewardsClaimed
        );
    }

    function everDistributedFeeRewards() external view returns (bool) {
        return _everDistributedFeeRewards;
    }

    // function everAllocatedFeeRewards() external view returns (bool) {
    //     return _everAllocatedFeeRewards;
    // }

    function feeRewardsToBeAllocated() external view returns (uint) {
        // when _everDistributedFeeRewards is true, _feeRewardsToBeAllocated has the right value
        // since _recentFeePeriodsStorage(0).feesToDistribute has the fee for the current network at the moment.
        return
            _everDistributedFeeRewards || (_recentFeePeriodsStorage(0).startTime > (now - getFeePeriodDuration()))
                ? _feeRewardsToBeAllocated
                : _recentFeePeriodsStorage(0).feesToDistribute;
    }

    function _recentFeePeriodsStorage(uint index) internal view returns (FeePeriod storage) {
        return _recentFeePeriods[(_currentFeePeriod + index) % FEE_PERIOD_LENGTH];
    }

    // function _allocatedOtherNetworkFeeRewards() internal view returns (uint allocatedFeesForOtherNetworks) {
    //     uint otherNetworksShare = SafeDecimalMath.preciseUnit().sub(crossChainManager().currentNetworkDebtPercentage());

    //     allocatedFeesForOtherNetworks = _recentFeePeriodsStorage(0)
    //         .feesToDistribute
    //         .decimalToPreciseDecimal()
    //         .multiplyDecimalRoundPrecise(otherNetworksShare)
    //         .preciseDecimalToDecimal();
    // }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function distributeFeeRewards(uint[] calldata feeRewards) external optionalProxy onlyDebtManager {
        require(getFeePeriodDuration() > 0, "Fee Period Duration not set");
        require(
            _recentFeePeriodsStorage(0).startTime <= (now - getFeePeriodDuration()),
            "distributing fee reward not yet available"
        );

        require(_everDistributedFeeRewards == false, "Distributing fee rewards is possible only once in a period");
        _everDistributedFeeRewards = true;

        // backup the fees from self network from last period.
        _feeRewardsToBeAllocated = _recentFeePeriodsStorage(0).feesToDistribute;

        uint totalFeeRewards;
        // Add up the fees from other networks
        for (uint i; i < feeRewards.length; i++) {
            totalFeeRewards = totalFeeRewards.add(feeRewards[i]);
        }
        // Add up the fees from self networks
        totalFeeRewards = totalFeeRewards.add(_feeRewardsToBeAllocated);

        // Set the proportionate rewards for self network
        _recentFeePeriodsStorage(0).feesToDistribute = totalFeeRewards
            .decimalToPreciseDecimal()
            .multiplyDecimalRoundPrecise(crossChainManager().currentNetworkDebtPercentage())
            .preciseDecimalToDecimal();

        if (_feeRewardsToBeAllocated > _recentFeePeriodsStorage(0).feesToDistribute) {
            // Burn the distributed rewards to other networks
            issuer().pynths(pUSD).burn(
                FEE_ADDRESS,
                _feeRewardsToBeAllocated.sub(_recentFeePeriodsStorage(0).feesToDistribute)
            );
        } else if (_feeRewardsToBeAllocated < _recentFeePeriodsStorage(0).feesToDistribute) {
            // Mint the extra rewards from other networks
            issuer().pynths(pUSD).issue(
                FEE_ADDRESS,
                _recentFeePeriodsStorage(0).feesToDistribute.sub(_feeRewardsToBeAllocated)
            );
        }

        // // If there are fees to be allocated to other networks, we need to burn them and subtract from feesToDistribute
        // if (_feeRewardsToBeAllocated > 0) {
        //     issuer().pynths(pUSD).burn(FEE_ADDRESS, _feeRewardsToBeAllocated);

        //     _feeRewardsToBeAllocated = _feeRewardsToBeAllocated;
        //     _recentFeePeriodsStorage(0).feesToDistribute = _recentFeePeriodsStorage(0).feesToDistribute.sub(
        //         _feeRewardsToBeAllocated
        //     );
        // }
    }

    // function allocateFeeRewards(uint amount) external optionalProxy onlyDebtManager {
    //     require(getFeePeriodDuration() > 0, "Fee Period Duration not set");
    //     require(
    //         _recentFeePeriodsStorage(0).startTime <= (now - getFeePeriodDuration()),
    //         "allocating fee reward not yet available"
    //     );

    //     require(_everAllocatedFeeRewards == false, "Allocating fee rewards is possible only once in a period");
    //     _everAllocatedFeeRewards = true;

    //     if (amount == 0) return;

    //     uint currentNetworkAllocatedFeeRewards =
    //         amount
    //             .decimalToPreciseDecimal()
    //             .multiplyDecimalRoundPrecise(crossChainManager().currentNetworkDebtPercentage())
    //             .preciseDecimalToDecimal();

    //     issuer().pynths(pUSD).issue(FEE_ADDRESS, currentNetworkAllocatedFeeRewards);

    //     _recentFeePeriodsStorage(0).feesToDistribute = _recentFeePeriodsStorage(0).feesToDistribute.add(
    //         currentNetworkAllocatedFeeRewards
    //     );
    // }

//     /**
//      * @notice Logs an accounts issuance data per fee period
//      * @param account Message.Senders account address
//      * @param debtRatio Debt percentage this account has locked after minting or burning their pynth
//      * @param debtEntryIndex The index in the global debt ledger. periFinanceState.issuanceData(account)
//      * @dev onlyIssuer to call me on periFinance.issue() & periFinance.burn() calls to store the locked PERI
//      * per fee period so we know to allocate the correct proportions of fees and rewards per period
//      */
//     function appendAccountIssuanceRecord(
//         address account,
//         uint debtRatio,
//         uint debtEntryIndex
//     ) external onlyIssuerAndPeriFinanceState {
//         require(false, "not implemented");
//   //      feePoolState().appendAccountIssuanceRecord(
//         //     account,
//         //     debtRatio,
//         //     debtEntryIndex,
//         //     _recentFeePeriodsStorage(0).startingDebtIndex
//         // );

//         emitIssuanceDebtRatioEntry(account, debtRatio, debtEntryIndex, _recentFeePeriodsStorage(0).startingDebtIndex);
//     }

    /**
     * @notice The Exchanger contract informs us when fees are paid.
     * @param amount susd amount in fees being paid.
     */
    function recordFeePaid(uint amount) external onlyInternalContracts {
        // Keep track off fees in pUSD in the open fee pool period.
        _recentFeePeriodsStorage(0).feesToDistribute = _recentFeePeriodsStorage(0).feesToDistribute.add(amount);
    }

    /**
     * @notice The RewardsDistribution contract informs us how many PERI rewards are sent to RewardEscrow to be claimed.
     */
    function setRewardsToDistribute(uint amount) external {
        address rewardsAuthority = address(rewardsDistribution());
        require(messageSender == rewardsAuthority || msg.sender == rewardsAuthority, "Caller is not rewardsAuthority");
        // Add the amount of PERI rewards to distribute on top of any rolling unclaimed amount
        _recentFeePeriodsStorage(0).rewardsToDistribute = _recentFeePeriodsStorage(0).rewardsToDistribute.add(amount);
    }

    function setQuotaTolerance(uint _val) external onlyOwner {
        require(_val < SafeDecimalMath.unit(), "Tolerance value cannot exceeds 1");

        quotaTolerance = _val;
    }

    /**
     * @notice Fix the recent period start time.
     */
    function setRecentPeriodStartTime(uint64 _startTime) external optionalProxy onlyDebtManager {
        require(now >= _startTime, "Cannot be more than the current time");
        _recentFeePeriodsStorage(0).startTime = _startTime;
    }

    /**
     * @notice Close the current fee period and start a new one.
     */
    function closeCurrentFeePeriod() external issuanceActive {
        require(getFeePeriodDuration() > 0, "Fee Period Duration not set");
        require(_recentFeePeriodsStorage(0).startTime <= (now - getFeePeriodDuration()), "Too early to close fee period");

        // get current oracle values
        (uint snxBackedDebt, ) = allNetworksSnxBackedDebt();
        (uint debtSharesSupply, ) = allNetworksDebtSharesSupply();

        // close on this chain
        _closeSecondary(snxBackedDebt, debtSharesSupply);

        // // inform other chain of the chosen values
        // IPynthetixBridgeToOptimism(
        //     resolver.requireAndGetAddress(
        //         CONTRACT_PERIFINANCE_BRIDGE_TO_OPTIMISM,
        //         "Missing contract: PeriFinanceBridgeToOptimism"
        //     )
        // )
        //     .closeFeePeriod(snxBackedDebt, debtSharesSupply);
    }

    function closeSecondary(uint allNetworksSnxBackedDebt, uint allNetworksDebtSharesSupply) external onlyRelayer {
        _closeSecondary(allNetworksSnxBackedDebt, allNetworksDebtSharesSupply);
    }

    /**
     * @notice Close the current fee period and start a new one.
     */
    function _closeSecondary(uint allNetworksSnxBackedDebt, uint allNetworksDebtSharesSupply) internal {
        etherWrapper().distributeFees();
        wrapperFactory().distributeFees();

        // before closing the current fee period, set the recorded snxBackedDebt and debtSharesSupply
        _recentFeePeriodsStorage(0).allNetworksDebtSharesSupply = allNetworksDebtSharesSupply;
        _recentFeePeriodsStorage(0).allNetworksSnxBackedDebt = allNetworksSnxBackedDebt;

        // Note:  periodClosing is the current period & periodToRollover is the last open claimable period
        FeePeriod storage periodClosing = _recentFeePeriodsStorage(0);
        FeePeriod storage periodToRollover = _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 1);

        // Any unclaimed fees from the last period in the array roll back one period.
        // Because of the subtraction here, they're effectively proportionally redistributed to those who
        // have already claimed from the old period, available in the new period.
        // The subtraction is important so we don't create a ticking time bomb of an ever growing
        // number of fees that can never decrease and will eventually overflow at the end of the fee pool.
        _recentFeePeriodsStorage(0).feesToDistribute = periodToRollover
            .feesToDistribute
            .sub(periodToRollover.feesClaimed)
            .add(periodClosing.feesToDistribute);
        _recentFeePeriodsStorage(0).rewardsToDistribute = periodToRollover
            .rewardsToDistribute
            .sub(periodToRollover.rewardsClaimed)
            .add(periodClosing.rewardsToDistribute);

        // Note: As of SIP-255, all sUSD fee are now automatically burned and are effectively shared amongst stakers in the form of reduced debt.
        if (_recentFeePeriodsStorage(0).feesToDistribute > 0) {
            issuer().burnPynthsWithoutDebt(pUSD, FEE_ADDRESS, _recentFeePeriodsStorage(0).feesToDistribute);

            // Mark the burnt fees as claimed.
            _recentFeePeriodsStorage(0).feesClaimed = _recentFeePeriodsStorage(0).feesToDistribute;
        }

        // Shift the previous fee periods across to make room for the new one.
        _currentFeePeriod = _currentFeePeriod.add(FEE_PERIOD_LENGTH).sub(1).mod(FEE_PERIOD_LENGTH);

        // Clear the first element of the array to make sure we don't have any stale values.
        delete _recentFeePeriods[_currentFeePeriod];

        // Open up the new fee period.
        // periodID is set to the current timestamp for compatibility with other systems taking snapshots on the debt shares
        uint newFeePeriodId = block.timestamp;
        _recentFeePeriodsStorage(0).feePeriodId = uint64(newFeePeriodId);
        _recentFeePeriodsStorage(0).startTime = uint64(block.timestamp);

        // Inform Issuer to start recording for the new fee period
        issuer().setCurrentPeriodId(uint128(newFeePeriodId));

        _everDistributedFeeRewards = false;

        emitFeePeriodClosed(_recentFeePeriodsStorage(1).feePeriodId);
    }

    // /**
    //  * @notice Close the current fee period and start a new one.
    //  */
    // function closeCurrentFeePeriod() external issuanceActive {
    //     require(getFeePeriodDuration() > 0, "Fee Period Duration not set");
    //     require(_recentFeePeriodsStorage(0).startTime <= (now - getFeePeriodDuration()), "Too early to close fee period");
    //     require(
    //         _everDistributedFeeRewards ||
    //             crossChainManager().currentNetworkDebtPercentage() == SafeDecimalMath.preciseUnit(),
    //         "fee rewards should be distributed before closing period"
    //     );

    //     // Note:  when FEE_PERIOD_LENGTH = 2, periodClosing is the current period & periodToRollover is the last open claimable period
    //     FeePeriod storage periodClosing = _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2);
    //     FeePeriod storage periodToRollover = _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 1);
    //     // IERC20 _perifinance = IERC20(requireAndGetAddress(CONTRACT_PERIFINANCE));

    //     // Any unclaimed fees from the last period in the array roll back one period.
    //     // Because of the subtraction here, they're effectively proportionally redistributed to those who
    //     // have already claimed from the old period, available in the new period.
    //     // The subtraction is important so we don't create a ticking time bomb of an ever growing
    //     // number of fees that can never decrease and will eventually overflow at the end of the fee pool.
    //     _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2).feesToDistribute = periodToRollover
    //         .feesToDistribute
    //         .add(periodClosing.feesToDistribute)
    //         .sub(periodToRollover.feesClaimed);
    //     _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2).rewardsToDistribute = periodToRollover
    //         .rewardsToDistribute
    //         .add(periodClosing.rewardsToDistribute)
    //         .sub(periodToRollover.rewardsClaimed);

    //     // _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2).rewardsToDistribute = _perifinance
    //     //     .balanceOf(requireAndGetAddress(CONTRACT_REWARDESCROW_V2))
    //     //     .sub(rewardEscrowV2().totalEscrowedBalance());

    //     // Shift the previous fee periods across to make room for the new one.
    //     _currentFeePeriod = _currentFeePeriod.add(FEE_PERIOD_LENGTH).sub(1).mod(FEE_PERIOD_LENGTH);

    //     // Clear the first element of the array to make sure we don't have any stale values.
    //     delete _recentFeePeriods[_currentFeePeriod];

    //     // Open up the new fee period.
    //     // Increment periodId from the recent closed period feePeriodId
    //     _recentFeePeriodsStorage(0).feePeriodId = uint64(uint256(_recentFeePeriodsStorage(1).feePeriodId).add(1));
    //     _recentFeePeriodsStorage(0).startingDebtIndex = uint64(periFinanceState().debtLedgerLength());
    //     _recentFeePeriodsStorage(0).startTime = uint64(now);

    //     // allow fee rewards to be distributed when the period is closed
    //     _everDistributedFeeRewards = false;
    //     // _everAllocatedFeeRewards = false;
    //     emitFeePeriodClosed(_recentFeePeriodsStorage(1).feePeriodId);
    // }

    // /**
    //  * @notice Close the current fee period and start a new one.
    //  */
    // function closeCurrentFeePeriod() external issuanceActive {
    //     require(getFeePeriodDuration() > 0, "Fee Period Duration not set");
    //     require(_recentFeePeriodsStorage(0).startTime <= (now - getFeePeriodDuration()), "Too early to close fee period");
    //     require(
    //         _everDistributedFeeRewards ||
    //             crossChainManager().currentNetworkDebtPercentage() == SafeDecimalMath.preciseUnit(),
    //         "fee rewards should be distributed before closing period"
    //     );

    //     // Note:  when FEE_PERIOD_LENGTH = 2, periodClosing is the current period & periodToRollover is the last open claimable period
    //     // get current oracle values
    //     (uint periBackedDebt, ) = allNetworksSnxBackedDebt();

    //     (uint debtSharesSupply, ) = allNetworksDebtSharesSupply();

    //     // close on this chain
    //     _closeSecondary(periBackedDebt, debtSharesSupply);


    //     //inform other chain of the chosen values
    //     IPeriFinanceBridgeToOptimism(
    //         resolver.requireAndGetAddress(
    //             CONTRACT_PERIFINANCE_BRIDGE_TO_OPTIMISM,
    //             "Missing contract: PeriFinanceBridgeToOptimism"
    //         )
    //     )
    //         .closeFeePeriod(periBackedDebt, debtSharesSupply);
    // }

    // function closeSecondary(uint allNetworksSnxBackedDebt, uint allNetworksDebtSharesSupply) external onlyRelayer {
    //     _closeSecondary(allNetworksSnxBackedDebt, allNetworksDebtSharesSupply);
    // }

    // /**
    //  * @notice Close the current fee period and start a new one.
    //  */
    // function _closeSecondary(uint allNetworksSnxBackedDebt, uint allNetworksDebtSharesSupply) internal {
    //     etherWrapper().distributeFees();
    //     wrapperFactory().distributeFees();

    //     // before closing the current fee period, set the recorded periBackedDebt and debtSharesSupply
    //     _recentFeePeriodsStorage(0).allNetworksDebtSharesSupply = allNetworksDebtSharesSupply;
    //     _recentFeePeriodsStorage(0).allNetworksSnxBackedDebt = allNetworksSnxBackedDebt;

    //     // Note:  periodClosing is the current period & periodToRollover is the last open claimable period
    //     FeePeriod storage periodClosing = _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2);
    //     FeePeriod storage periodToRollover = _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 1);
    //     // IERC20 _perifinance = IERC20(requireAndGetAddress(CONTRACT_PERIFINANCE));

    //     // Any unclaimed fees from the last period in the array roll back one period.
    //     // Because of the subtraction here, they're effectively proportionally redistributed to those who
    //     // have already claimed from the old period, available in the new period.
    //     // The subtraction is important so we don't create a ticking time bomb of an ever growing
    //     // number of fees that can never decrease and will eventually overflow at the end of the fee pool.
    //     _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2).feesToDistribute = periodToRollover
    //         .feesToDistribute
    //         .sub(periodToRollover.feesClaimed)
    //         .add(periodClosing.feesToDistribute);
    //       _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2).rewardsToDistribute = periodToRollover
    //         .rewardsToDistribute
    //         .sub(periodToRollover.rewardsClaimed)
    //         .add(periodClosing.rewardsToDistribute);

    //     // Note: As of SIP-255, all pUSD fee are now automatically burned and are effectively shared amongst stakers in the form of reduced debt.
    //     if (_recentFeePeriodsStorage(0).feesToDistribute > 0) {
    //         //issuer().burnPynthsWithoutDebt(pUSD, FEE_ADDRESS, _recentFeePeriodsStorage(0).feesToDistribute);

    //         // Mark the burnt fees as claimed.
    //         _recentFeePeriodsStorage(0).feesClaimed = _recentFeePeriodsStorage(0).feesToDistribute;
    //     }

    //     // Shift the previous fee periods across to make room for the new one.
    //     _currentFeePeriod = _currentFeePeriod.add(FEE_PERIOD_LENGTH).sub(1).mod(FEE_PERIOD_LENGTH);

    //     // Clear the first element of the array to make sure we don't have any stale values.
    //     delete _recentFeePeriods[_currentFeePeriod];

    //     // Open up the new fee period.
    //     // Increment periodId from the recent closed period feePeriodId
    //      _recentFeePeriodsStorage(0).feePeriodId = uint64(uint256(_recentFeePeriodsStorage(1).feePeriodId).add(1));
    //     _recentFeePeriodsStorage(0).startingDebtIndex = uint64(periFinanceState().debtLedgerLength());
    //     _recentFeePeriodsStorage(0).startTime = uint64(now);
    //     // Inform Issuer to start recording for the new fee period
    //    // issuer().setCurrentPeriodId(uint128(newFeePeriodId));

    //     // allow fee rewards to be distributed when the period is closed
    //     _everDistributedFeeRewards = false;
    //     // _everAllocatedFeeRewards = false;
    //     emitFeePeriodClosed(_recentFeePeriodsStorage(1).feePeriodId);
    // }

    /**
     * @notice Claim fees for last period when available or not already withdrawn.
     */
    function claimFees() external issuanceActive optionalProxy returns (bool) {
        return _claimFees(messageSender);
    }

    /**
     * @notice Delegated claimFees(). Call from the deletegated address
     * and the fees will be sent to the claimingForAddress.
     * approveClaimOnBehalf() must be called first to approve the deletage address
     * @param claimingForAddress The account you are claiming fees for
     */
    function claimOnBehalf(address claimingForAddress) external issuanceActive optionalProxy returns (bool) {
        require(delegateApprovals().canClaimFor(claimingForAddress, messageSender), "Not approved to claim on behalf");

        return _claimFees(claimingForAddress);
    }

    function _claimFees(address claimingAddress) internal returns (bool) {
        uint rewardsPaid;
        uint feesPaid;
        uint availableFees;
        uint availableRewards;

        // Address won't be able to claim fees if it is too far below the target c-ratio.
        // It will need to burn pynths then try claiming again.
        bool feesClaimable = _isFeesClaimableAndAnyRatesInvalid(claimingAddress, true);

        require(feesClaimable, "C-Ratio below penalty threshold");

        // require(!anyRateIsInvalid, "A pynth or PERI rate is invalid");

        // Get the claimingAddress available fees and rewards
        (availableFees, availableRewards) = feesAvailable(claimingAddress);

        require(
            availableFees > 0 || availableRewards > 0,
            "No fees or rewards available for period, or fees already claimed"
        );

        // Record the address has claimed for this period
        _setLastFeeWithdrawal(claimingAddress, _recentFeePeriodsStorage(1).feePeriodId);

        feesPaid = availableFees;

        // if (availableFees > 0) {
        //     // Record the fee payment in our recentFeePeriods
        //     feesPaid = _recordFeePayment(availableFees);

        //     // Send them their fees
        //     _payFees(claimingAddress, feesPaid);
        // }

        if (availableRewards > 0) {
            // Record the reward payment in our recentFeePeriods
            rewardsPaid = _recordRewardPayment(availableRewards);

            // Send them their rewards
            _payRewards(claimingAddress, rewardsPaid);
        }

        emitFeesClaimed(claimingAddress, feesPaid, rewardsPaid);

        return true;
    }

    /**
     * @notice Admin function to import the FeePeriod data from the previous contract
     */
    function importFeePeriod(
        uint feePeriodIndex,
        uint feePeriodId,
        uint startTime,
        uint feesToDistribute,
        uint feesClaimed,
        uint rewardsToDistribute,
        uint rewardsClaimed
    ) public optionalProxy_onlyOwner onlyDuringSetup {
        require(feePeriodIndex < FEE_PERIOD_LENGTH, "invalid fee period index");
        //require(startingDebtIndex <= periFinanceState().debtLedgerLength(), "Cannot import bad data");

        _recentFeePeriods[_currentFeePeriod.add(feePeriodIndex).mod(FEE_PERIOD_LENGTH)] = FeePeriod({
            feePeriodId: uint64(feePeriodId),
            //startingDebtIndex: uint64(startingDebtIndex),
            startTime: uint64(startTime),
            feesToDistribute: feesToDistribute,
            feesClaimed: feesClaimed,
            rewardsToDistribute: rewardsToDistribute,
            rewardsClaimed: rewardsClaimed,
            allNetworksSnxBackedDebt: 0,
            allNetworksDebtSharesSupply: 0
        });

        // make sure recording is aware of the actual period id
        if (feePeriodIndex == 0) {
            issuer().setCurrentPeriodId(uint128(feePeriodId));
        }
    } 

    function setInitialFeePeriods(address prevFeePool) external optionalProxy_onlyOwner onlyDuringSetup {
        require(prevFeePool != address(0), "Previous FeePool address must be set");

        for (uint i; i < FEE_PERIOD_LENGTH; i++) {
            (
                uint64 feePeriodId,
                uint64 startTime,
                uint feesToDistribute,
                uint feesClaimed,
                uint rewardsToDistribute,
                uint rewardsClaimed
            ) = IFeePool(prevFeePool).recentFeePeriods(i);

            _recentFeePeriodsStorage(i).feePeriodId = feePeriodId;
            //_recentFeePeriodsStorage(i).startingDebtIndex = startingDebtIndex;
            _recentFeePeriodsStorage(i).startTime = startTime;
            _recentFeePeriodsStorage(i).feesToDistribute = feesToDistribute;
            _recentFeePeriodsStorage(i).feesClaimed = feesClaimed;
            _recentFeePeriodsStorage(i).rewardsToDistribute = rewardsToDistribute;
            _recentFeePeriodsStorage(i).rewardsClaimed = rewardsClaimed;
        }
    }

    /**
     * @notice Record the fee payment in our recentFeePeriods.
     * @param pUSDAmount The amount of fees priced in pUSD.
     */
    function _recordFeePayment(uint pUSDAmount) internal returns (uint feesPaid) {
        // Don't assign to the parameter
        uint remainingToAllocate = pUSDAmount;

        // Start at the oldest period and record the amount, moving to newer periods
        // until we've exhausted the amount.
        // The condition checks for overflow because we're going to 0 with an unsigned int.
        for (uint i = FEE_PERIOD_LENGTH - 1; i < FEE_PERIOD_LENGTH; i--) {
            uint feesAlreadyClaimed = _recentFeePeriodsStorage(i).feesClaimed;
            uint delta = _recentFeePeriodsStorage(i).feesToDistribute.sub(feesAlreadyClaimed);

            if (delta > 0) {
                // Take the smaller of the amount left to claim in the period and the amount we need to allocate
                uint amountInPeriod = delta < remainingToAllocate ? delta : remainingToAllocate;

                _recentFeePeriodsStorage(i).feesClaimed = feesAlreadyClaimed.add(amountInPeriod);
                remainingToAllocate = remainingToAllocate.sub(amountInPeriod);
                feesPaid = feesPaid.add(amountInPeriod);

                // No need to continue iterating if we've recorded the whole amount;
                if (remainingToAllocate == 0) return feesPaid;

                // We've exhausted feePeriods to distribute and no fees remain in last period
                // User last to claim would in this scenario have their remainder slashed
                if (i == 0 && remainingToAllocate > 0) {
                    remainingToAllocate = 0;
                }
            }
        }

        // return feesPaid;
    }

    /**
     * @notice Record the reward payment in our recentFeePeriods.
     * @param periAmount The amount of PERI tokens.
     */
    function _recordRewardPayment(uint periAmount) internal returns (uint rewardPaid) {
        // Don't assign to the parameter
        uint remainingToAllocate = periAmount;

        // uint rewardPaid;

        // Start at the oldest period and record the amount, moving to newer periods
        // until we've exhausted the amount.
        // The condition checks for overflow because we're going to 0 with an unsigned int.
        for (uint i = FEE_PERIOD_LENGTH - 1; i < FEE_PERIOD_LENGTH; i--) {
            uint toDistribute =
                _recentFeePeriodsStorage(i).rewardsToDistribute.sub(_recentFeePeriodsStorage(i).rewardsClaimed);

            if (toDistribute > 0) {
                // Take the smaller of the amount left to claim in the period and the amount we need to allocate
                uint amountInPeriod = toDistribute < remainingToAllocate ? toDistribute : remainingToAllocate;

                _recentFeePeriodsStorage(i).rewardsClaimed = _recentFeePeriodsStorage(i).rewardsClaimed.add(amountInPeriod);
                remainingToAllocate = remainingToAllocate.sub(amountInPeriod);
                rewardPaid = rewardPaid.add(amountInPeriod);

                // No need to continue iterating if we've recorded the whole amount;
                if (remainingToAllocate == 0) return rewardPaid;

                // We've exhausted feePeriods to distribute and no rewards remain in last period
                // User last to claim would in this scenario have their remainder slashed
                // due to rounding up of PreciseDecimal
                if (i == 0 && remainingToAllocate > 0) {
                    remainingToAllocate = 0;
                }
            }
        }
        // return rewardPaid;
    }

    /**
     * @notice Send the fees to claiming address.
     * @param account The address to send the fees to.
     * @param pUSDAmount The amount of fees priced in pUSD.
     */
    function _payFees(address account, uint pUSDAmount) internal notFeeAddress(account) {
        // Grab the pUSD Pynth
        IPynth pUSDPynth = issuer().pynths(pUSD);

        // NOTE: we do not control the FEE_ADDRESS so it is not possible to do an
        // ERC20.approve() transaction to allow this feePool to call ERC20.transferFrom
        // to the accounts address

        // Burn the source amount
        pUSDPynth.burn(FEE_ADDRESS, pUSDAmount);

        // Mint their new pynths
        pUSDPynth.issue(account, pUSDAmount);
    }

    /**
     * @notice Send the rewards to claiming address - will be locked in rewardEscrow.
     * @param account The address to send the fees to.
     * @param periAmount The amount of PERI.
     */
    function _payRewards(address account, uint periAmount) internal notFeeAddress(account) {
        /* Escrow the tokens for 1 year. */
        uint escrowDuration = 52 weeks;

        // Record vesting entry for claiming address and amount
        // PERI already minted to rewardEscrow balance
        rewardEscrowV2().appendVestingEntry(account, periAmount, escrowDuration);
    }

    /**
     * @notice The total fees available in the system to be withdrawnn in pUSD
     */
    function totalFeesAvailable() external view returns (uint) {
        uint totalFees = 0;

        // Fees in fee period [0] are not yet available for withdrawal
        for (uint i = 1; i < FEE_PERIOD_LENGTH; i++) {
            totalFees = totalFees.add(_recentFeePeriodsStorage(i).feesToDistribute);
            totalFees = totalFees.sub(_recentFeePeriodsStorage(i).feesClaimed);
        }

        return totalFees;
    }

    /**
     * @notice The total fees that were already burned (i.e. claimed) in the previous fee period [1].
     */
    function totalFeesBurned() external view returns (uint) {
        return _recentFeePeriodsStorage(1).feesClaimed;
    }

    /**
     * @notice The total PERI rewards available in the system to be withdrawn
     */
    function totalRewardsAvailable() external view returns (uint totalRewards) {
        // Rewards in fee period [0] are not yet available for withdrawal
        for (uint i = 1; i < FEE_PERIOD_LENGTH; i++) {
            totalRewards = totalRewards.add(_recentFeePeriodsStorage(i).rewardsToDistribute);
            totalRewards = totalRewards.sub(_recentFeePeriodsStorage(i).rewardsClaimed);
        }
    }

    /**
     * @notice The fees available to be withdrawn by a specific account, priced in pUSD
     * @dev Returns two amounts, one for fees and one for PERI rewards
     */
    function feesAvailable(address account) public view returns (uint totalFees, uint totalRewards) {
        // Add up the fees
        uint[2][FEE_PERIOD_LENGTH] memory userFees = feesByPeriod(account);

        // Fees & Rewards in fee period [0] are not yet available for withdrawal
        for (uint i = 1; i < FEE_PERIOD_LENGTH; i++) {
            totalFees = totalFees.add(userFees[i][0]);
            totalRewards = totalRewards.add(userFees[i][1]);
        }

        // And convert totalFees to pUSD
        // Return totalRewards as is in PERI amount
        // return (totalFees, totalRewards);
    }

/**
     * @notice The total amount of fees burned for a specific account in the previous period [1].
     * Note: Fees in the current fee period [0] are not yet burned.
     */
    function feesBurned(address account) public view returns (uint) {
        uint[FEE_PERIOD_LENGTH][2] memory userFees = feesByPeriod(account);
        return userFees[1][0];
    }

    /**
     * @notice The amount of fees to be burned for an account during the current fee period [0].
     * Note: this returns an approximate value based on the current system rate. Any changes in debt shares may affect the outcome of the final amount.
     * This also does not consider pending fees in the wrappers since they are distributed at fee period close.
     */
    function feesToBurn(address account) public view returns (uint feesFromPeriod) {
        IPeriFinanceDebtShare sds = periFinanceDebtShare();
        uint userOwnershipPercentage = sds.sharePercent(account);
        (feesFromPeriod, ) = _feesAndRewardsFromPeriod(0, userOwnershipPercentage);
        return feesFromPeriod;
    }

    function _isFeesClaimableAndAnyRatesInvalid(address account, bool _checkRate)
        internal
        view
        returns (bool feesClaimable)
    {
        // complete: Check if this is still needed
        // External token staked amount should not over the quota limit.
        /* uint accountExternalTokenQuota = issuer().externalTokenQuota(account, 0, 0, true);
        if (
            accountExternalTokenQuota > getExternalTokenQuota().multiplyDecimal(SafeDecimalMath.unit().add(quotaTolerance))
        ) {
            return (false, false);
        } */

        (uint tRatio, uint ratio, , , uint exSR, uint maxSR) = issuer().getRatios(account, _checkRate);

        // uint ratio;
        // Threshold is calculated from ratio % above the target ratio (issuanceRatio).
        // 10 decimals round-up is used to ensure that the threshold is reached when the ratio is above the target ratio.

        feesClaimable = true;
        // Claimable if collateral ratio below target ratio
        if (ratio <= tRatio && exSR <= maxSR) {
            return feesClaimable;
        }

        // Calculate the threshold for collateral ratio before fees can't be claimed.
        uint ratioThreshold = ratio.roundDownDecimal(uint(12));
        uint exSRThreshold = maxSR.multiplyDecimal(SafeDecimalMath.unit().add(getTargetThreshold()));

        // Not claimable if collateral ratio above threshold
        if (ratioThreshold > tRatio || exSR > exSRThreshold) {
            feesClaimable = false;
        }
    }

    // function FeesClaimableRates(address account, bool _checkRate)
    //     external
    //     view
    //     returns (bool feesClaimable, uint ratioThreshold, uint exSRThreshold)

    // {
    //     // complete: Check if this is still needed
    //     // External token staked amount should not over the quota limit.
    //     /* uint accountExternalTokenQuota = issuer().externalTokenQuota(account, 0, 0, true);
    //     if (
    //         accountExternalTokenQuota > getExternalTokenQuota().multiplyDecimal(SafeDecimalMath.unit().add(quotaTolerance))
    //     ) {
    //         return (false, false);
    //     } */

    //     (uint tRatio, uint ratio, , , uint exSR, uint maxSR) = issuer().getRatios(account, _checkRate);

    //     // uint ratio;
    //     // Threshold is calculated from ratio % above the target ratio (issuanceRatio).
    //     // 10 decimals round-up is used to ensure that the threshold is reached when the ratio is above the target ratio.

    //     feesClaimable = true;
    //     // Claimable if collateral ratio below target ratio
    //     if (ratio <= tRatio && exSR <= maxSR) {
    //         return (feesClaimable, 0, 0);
    //     }

    //     // Calculate the threshold for collateral ratio before fees can't be claimed.
    //     ratioThreshold = ratio.roundDownDecimal(uint(12));
    //     exSRThreshold = maxSR.multiplyDecimal(SafeDecimalMath.unit().add(getTargetThreshold()));

    //     // Not claimable if collateral ratio above threshold
    //     if (ratioThreshold > tRatio || exSR > exSRThreshold) {
    //         feesClaimable = false;
    //     }
    // }

    function isFeesClaimable(address account) external view returns (bool feesClaimable) {
        return _isFeesClaimableAndAnyRatesInvalid(account, false);
    }

    /**
     * @notice Calculates fees by period for an account, priced in pUSD
     * @param account The address you want to query the fees for
     */
    function feesByPeriod(address account) public view returns (uint[2][FEE_PERIOD_LENGTH] memory results) {
        // What's the user's debt entry index and the debt they owe to the system at current feePeriod
        uint userOwnershipPercentage;

        IPeriFinanceDebtShare pds = periFinanceDebtShare();

        userOwnershipPercentage = pds.sharePercent(account);

        uint feesFromPeriod;
        uint rewardsFromPeriod;
        (feesFromPeriod, rewardsFromPeriod) = _feesAndRewardsFromPeriod(0, userOwnershipPercentage);

        results[0][0] = feesFromPeriod;
        results[0][1] = rewardsFromPeriod;

        // Retrieve user's last fee claim by periodId
        uint lastFeeWithdrawal = getLastFeeWithdrawal(account);

        for (uint i = FEE_PERIOD_LENGTH - 1; i > 0; i--) {

   
            uint64 periodId = _recentFeePeriodsStorage(i).feePeriodId;
                    
            if (lastFeeWithdrawal < periodId) {
                userOwnershipPercentage = pds.sharePercentOnPeriod(account, uint(periodId));

                (feesFromPeriod, rewardsFromPeriod) = _feesAndRewardsFromPeriod(i, userOwnershipPercentage);

                results[i][0] = feesFromPeriod;
                results[i][1] = rewardsFromPeriod;
            }
        }
    }

    /**
     * @notice ownershipPercentage is a high precision decimals uint based on
     * wallet's debtPercentage. Gives a precise amount of the feesToDistribute
     * for fees in the period. Precision factor is removed before results are
     * returned.
     * @dev The reported fees owing for the current period [0] are just a
     * running balance until the fee period closes
     */
    function _feesAndRewardsFromPeriod(
        uint period,
        uint ownershipPercentage
    ) internal view returns (uint, uint) {
        // If it's zero, they haven't issued, and they have no fees OR rewards.


        if (ownershipPercentage == 0) return (0, 0);

         FeePeriod storage fp = _recentFeePeriodsStorage(period);

        // Calculate their percentage of the fees / rewards in this period
        // This is a high precision integer.
        uint feesFromPeriod = fp.feesToDistribute.multiplyDecimal(ownershipPercentage);

        uint rewardsFromPeriod = fp.rewardsToDistribute.multiplyDecimal(ownershipPercentage);

        return (feesFromPeriod, rewardsFromPeriod);

        // uint debtOwnershipForPeriod = ownershipPercentage;

        // // If period has closed we want to calculate debtPercentage for the period
        // if (period > 0) {
        //     uint closingDebtIndex = uint256(_recentFeePeriodsStorage(period - 1).startingDebtIndex).sub(1);
        //     debtOwnershipForPeriod = _effectiveDebtRatioForPeriod(closingDebtIndex, ownershipPercentage, debtEntryIndex);
        // }

        // // Calculate their percentage of the fees / rewards in this period
        // // This is a high precision integer.
        // uint feesFromPeriod = _recentFeePeriodsStorage(period).feesToDistribute.multiplyDecimal(debtOwnershipForPeriod);

        // uint rewardsFromPeriod =
        //     _recentFeePeriodsStorage(period).rewardsToDistribute.multiplyDecimal(debtOwnershipForPeriod);

        // return (feesFromPeriod.preciseDecimalToDecimal(), rewardsFromPeriod.preciseDecimalToDecimal());
    }

    function _effectiveDebtRatioForPeriod(
        uint closingDebtIndex,
        uint ownershipPercentage,
        uint debtEntryIndex
    ) internal view returns (uint) {
        // Figure out their global debt percentage delta at end of fee Period.
        // This is a high precision integer.
        IPeriFinanceState _periFinanceState = periFinanceState();
        uint feePeriodDebtOwnership =
            _periFinanceState
                .debtLedger(closingDebtIndex)
                .divideDecimalRoundPrecise(_periFinanceState.debtLedger(debtEntryIndex))
                .multiplyDecimalRoundPrecise(ownershipPercentage);

        return feePeriodDebtOwnership;
    }
    
    function effectiveDebtRatioForPeriod(address account, uint period) external view returns (uint) {
        // if period is not closed yet, or outside of the fee period range, return 0 instead of reverting
        if (period == 0 || period >= FEE_PERIOD_LENGTH) {
            return 0;
        }

        // If the period being checked is uninitialised then return 0. This is only at the start of the system.
        if (_recentFeePeriodsStorage(period - 1).startTime == 0) return 0;

        return periFinanceDebtShare().sharePercentOnPeriod(account, uint(_recentFeePeriods[period].feePeriodId));
    }

    /**
     * @notice Get the feePeriodID of the last claim this account made
     * @param _claimingAddress account to check the last fee period ID claim for
     * @return uint of the feePeriodID this account last claimed
     */
    function getLastFeeWithdrawal(address _claimingAddress) public view returns (uint) {
        return feePoolEternalStorage().getUIntValue(keccak256(abi.encodePacked(LAST_FEE_WITHDRAWAL, _claimingAddress)));
    }

    /**
     * @notice Calculate the collateral ratio before user is blocked from claiming.
     */
    function getPenaltyThresholdRatio() public view returns (uint) {
        return getIssuanceRatio().multiplyDecimal(SafeDecimalMath.unit().add(getTargetThreshold()));
    }

    /**
     * @notice Set the feePeriodID of the last claim this account made
     * @param _claimingAddress account to set the last feePeriodID claim for
     * @param _feePeriodID the feePeriodID this account claimed fees for
     */
    function _setLastFeeWithdrawal(address _claimingAddress, uint _feePeriodID) internal {
        feePoolEternalStorage().setUIntValue(
            keccak256(abi.encodePacked(LAST_FEE_WITHDRAWAL, _claimingAddress)),
            _feePeriodID
        );
    }

    function _debtManager() internal view returns (address) {
        return crossChainManager().debtManager();
    }

    /* ========== Modifiers ========== */


    function _isInternalContract(address account) internal view returns (bool) {
        return
            account == address(exchanger()) ||
            issuer().pynthsByAddress(account) != bytes32(0) ||
            collateralManager().hasCollateral(account) ||
            account == address(futuresMarketManager()) ||
            account == address(wrapperFactory()) ||
            account == address(etherWrapper());
    }

    modifier onlyInternalContracts {
        require(_isInternalContract(msg.sender), "Only Internal Contracts");
        _;
    }

    modifier onlyRelayer {
        require(
            msg.sender == address(this) || msg.sender == resolver.getAddress(CONTRACT_PERIFINANCE_BRIDGE_TO_BASE),
            "Only valid relayer can call"
        );
        _;
    }


    modifier onlyIssuerAndPeriFinanceState {
        bool isIssuer = msg.sender == address(issuer());
        bool isPeriFinanceState = msg.sender == address(periFinanceState());
        require(isIssuer || isPeriFinanceState, "Issuer and PeriFinanceState only");
        _;
    }

    modifier onlyDebtManager {
        bool isDebtManager = messageSender == _debtManager();
        require(isDebtManager, "debt manager only");
        _;
    }

    modifier notFeeAddress(address account) {
        require(account != FEE_ADDRESS, "Fee address not allowed");
        _;
    }

    modifier issuanceActive() {
        systemStatus().requireIssuanceActive();
        _;
    }

    /* ========== Proxy Events ========== */

    event IssuanceDebtRatioEntry(
        address indexed account,
        uint debtRatio,
        uint debtEntryIndex,
        uint feePeriodStartingDebtIndex
    );
    bytes32 private constant ISSUANCEDEBTRATIOENTRY_SIG =
        keccak256("IssuanceDebtRatioEntry(address,uint256,uint256,uint256)");

    function emitIssuanceDebtRatioEntry(
        address account,
        uint debtRatio,
        uint debtEntryIndex,
        uint feePeriodStartingDebtIndex
    ) internal {
        proxy._emit(
            abi.encode(debtRatio, debtEntryIndex, feePeriodStartingDebtIndex),
            2,
            ISSUANCEDEBTRATIOENTRY_SIG,
            bytes32(uint256(uint160(account))),
            0,
            0
        );
    }

    event FeePeriodClosed(uint feePeriodId);
    bytes32 private constant FEEPERIODCLOSED_SIG = keccak256("FeePeriodClosed(uint256)");

    function emitFeePeriodClosed(uint feePeriodId) internal {
        proxy._emit(abi.encode(feePeriodId), 1, FEEPERIODCLOSED_SIG, 0, 0, 0);
    }

    event FeesClaimed(address account, uint pUSDAmount, uint periRewards);
    bytes32 private constant FEESCLAIMED_SIG = keccak256("FeesClaimed(address,uint256,uint256)");

    function emitFeesClaimed(
        address account,
        uint pUSDAmount,
        uint periRewards
    ) internal {
        proxy._emit(abi.encode(account, pUSDAmount, periRewards), 1, FEESCLAIMED_SIG, 0, 0, 0);
    }
}
