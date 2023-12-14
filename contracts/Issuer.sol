pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/IIssuer.sol";

// Libraries
import "./SafeDecimalMath.sol";

// Internal references
import "./interfaces/IPynth.sol";
import "./interfaces/IPeriFinance.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IPeriFinanceState.sol";
import "./interfaces/IExchanger.sol";
import "./interfaces/IDelegateApprovals.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IEtherCollateral.sol";
import "./interfaces/IEtherCollateralpUSD.sol";
import "./interfaces/IHasBalance.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/ILiquidations.sol";
import "./interfaces/ICollateralManager.sol";
import "./interfaces/IExternalTokenStakeManager.sol";
import "./interfaces/ICrossChainManager.sol";

interface IRewardEscrowV2 {
    // Views
    function balanceOf(address account) external view returns (uint);
}

interface IIssuerInternalDebtCache {
    function updateCachedPynthDebtWithRate(bytes32 currencyKey, uint currencyRate) external;

    function updateCachedPynthDebtsWithRates(bytes32[] calldata currencyKeys, uint[] calldata currencyRates) external;

    function updateDebtCacheValidity(bool currentlyInvalid) external;

    function cacheInfo()
        external
        view
        returns (
            uint cachedDebt,
            uint timestamp,
            bool isInvalid,
            bool isStale
        );
}

// https://docs.peri.finance/contracts/source/contracts/issuer
contract Issuer is Owned, MixinSystemSettings, IIssuer {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    // Available Pynths which can be used with the system
    IPynth[] public availablePynths;
    mapping(bytes32 => IPynth) public pynths;
    mapping(address => bytes32) public pynthsByAddress;

    /* ========== ENCODED NAMES ========== */

    bytes32 internal constant pUSD = "pUSD";
    bytes32 internal constant pETH = "pETH";
    bytes32 internal constant PERI = "PERI";

    // Flexible storage names

    bytes32 public constant CONTRACT_NAME = "Issuer";
    bytes32 internal constant LAST_ISSUE_EVENT = "lastIssueEvent";

    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_PERIFINANCE = "PeriFinance";
    bytes32 private constant CONTRACT_EXCHANGER = "Exchanger";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";
    bytes32 private constant CONTRACT_PERIFINANCESTATE = "PeriFinanceState";
    bytes32 private constant CONTRACT_FEEPOOL = "FeePool";
    bytes32 private constant CONTRACT_DELEGATEAPPROVALS = "DelegateApprovals";
    bytes32 private constant CONTRACT_ETHERCOLLATERAL = "EtherCollateral";
    bytes32 private constant CONTRACT_ETHERCOLLATERAL_PUSD = "EtherCollateralpUSD";
    bytes32 private constant CONTRACT_COLLATERALMANAGER = "CollateralManager";
    bytes32 private constant CONTRACT_REWARDESCROW_V2 = "RewardEscrowV2";
    bytes32 private constant CONTRACT_PERIFINANCEESCROW = "PeriFinanceEscrow";
    bytes32 private constant CONTRACT_LIQUIDATIONS = "Liquidations";
    bytes32 private constant CONTRACT_DEBTCACHE = "DebtCache";
    bytes32 private constant CONTRACT_EXTOKENSTAKEMANAGER = "ExternalTokenStakeManager";
    bytes32 private constant CONTRACT_CROSSCHAINMANAGER = "CrossChainManager";

    constructor(address _owner, address _resolver) public Owned(_owner) MixinSystemSettings(_resolver) {}

    /* ========== VIEWS ========== */
    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](15);
        newAddresses[0] = CONTRACT_PERIFINANCE;
        newAddresses[1] = CONTRACT_EXCHANGER;
        newAddresses[2] = CONTRACT_EXRATES;
        newAddresses[3] = CONTRACT_PERIFINANCESTATE;
        newAddresses[4] = CONTRACT_FEEPOOL;
        newAddresses[5] = CONTRACT_DELEGATEAPPROVALS;
        newAddresses[6] = CONTRACT_ETHERCOLLATERAL;
        newAddresses[7] = CONTRACT_ETHERCOLLATERAL_PUSD;
        newAddresses[8] = CONTRACT_REWARDESCROW_V2;
        newAddresses[9] = CONTRACT_PERIFINANCEESCROW;
        newAddresses[10] = CONTRACT_LIQUIDATIONS;
        newAddresses[11] = CONTRACT_DEBTCACHE;
        newAddresses[12] = CONTRACT_COLLATERALMANAGER;
        newAddresses[13] = CONTRACT_EXTOKENSTAKEMANAGER;
        newAddresses[14] = CONTRACT_CROSSCHAINMANAGER;
        return combineArrays(existingAddresses, newAddresses);
    }

    function periFinance() internal view returns (IPeriFinance) {
        return IPeriFinance(requireAndGetAddress(CONTRACT_PERIFINANCE));
    }

    function exTokenStakeManager() internal view returns (IExternalTokenStakeManager) {
        return IExternalTokenStakeManager(requireAndGetAddress(CONTRACT_EXTOKENSTAKEMANAGER));
    }

    function exchanger() internal view returns (IExchanger) {
        return IExchanger(requireAndGetAddress(CONTRACT_EXCHANGER));
    }

    function exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXRATES));
    }

    function periFinanceState() internal view returns (IPeriFinanceState) {
        return IPeriFinanceState(requireAndGetAddress(CONTRACT_PERIFINANCESTATE));
    }

    function feePool() internal view returns (IFeePool) {
        return IFeePool(requireAndGetAddress(CONTRACT_FEEPOOL));
    }

    function liquidations() internal view returns (ILiquidations) {
        return ILiquidations(requireAndGetAddress(CONTRACT_LIQUIDATIONS));
    }

    function delegateApprovals() internal view returns (IDelegateApprovals) {
        return IDelegateApprovals(requireAndGetAddress(CONTRACT_DELEGATEAPPROVALS));
    }

    function etherCollateral() internal view returns (IEtherCollateral) {
        return IEtherCollateral(requireAndGetAddress(CONTRACT_ETHERCOLLATERAL));
    }

    function etherCollateralpUSD() internal view returns (IEtherCollateralpUSD) {
        return IEtherCollateralpUSD(requireAndGetAddress(CONTRACT_ETHERCOLLATERAL_PUSD));
    }

    function collateralManager() internal view returns (ICollateralManager) {
        return ICollateralManager(requireAndGetAddress(CONTRACT_COLLATERALMANAGER));
    }

    function rewardEscrowV2() internal view returns (IRewardEscrowV2) {
        return IRewardEscrowV2(requireAndGetAddress(CONTRACT_REWARDESCROW_V2));
    }

    function periFinanceEscrow() internal view returns (IHasBalance) {
        return IHasBalance(requireAndGetAddress(CONTRACT_PERIFINANCEESCROW));
    }

    function debtCache() internal view returns (IIssuerInternalDebtCache) {
        return IIssuerInternalDebtCache(requireAndGetAddress(CONTRACT_DEBTCACHE));
    }

    function crossChainManager() internal view returns (ICrossChainManager) {
        return ICrossChainManager(requireAndGetAddress(CONTRACT_CROSSCHAINMANAGER));
    }

    function _availableCurrencyKeysWithOptionalPERI(bool withPERI) internal view returns (bytes32[] memory) {
        bytes32[] memory currencyKeys = new bytes32[](availablePynths.length + (withPERI ? 1 : 0));

        for (uint i; i < availablePynths.length; i++) {
            currencyKeys[i] = pynthsByAddress[address(availablePynths[i])];
        }

        if (withPERI) {
            currencyKeys[availablePynths.length] = PERI;
        }

        return currencyKeys;
    }

    function _totalIssuedPynths(bytes32 currencyKey, bool excludeCollateral)
        internal
        view
        returns (uint totalIssued, bool anyRateIsInvalid)
    {
        (uint debt, , bool cacheIsInvalid, bool cacheIsStale) = debtCache().cacheInfo();
        // anyRateIsInvalid = cacheIsInvalid || cacheIsStale;

        // IExchangeRates exRates = exchangeRates();

        // Add total issued pynths from non peri collateral back into the total if not excluded
        if (!excludeCollateral) {
            // Get the pUSD equivalent amount of all the MC issued pynths.
            (uint nonPeriDebt, bool invalid) = collateralManager().totalLong();
            debt = debt.add(nonPeriDebt);
            // anyRateIsInvalid = anyRateIsInvalid || invalid;

            // Now add the ether collateral stuff as we are still supporting it.
            debt = debt.add(etherCollateralpUSD().totalIssuedPynths());

            // Add ether collateral pETH
            (uint ethRate, bool ethRateInvalid) = exchangeRates().rateAndInvalid(pETH);
            uint ethIssuedDebt = etherCollateral().totalIssuedPynths().multiplyDecimalRound(ethRate);
            debt = debt.add(ethIssuedDebt);
            anyRateIsInvalid = invalid || ethRateInvalid;
        }

        anyRateIsInvalid = anyRateIsInvalid || cacheIsInvalid || cacheIsStale;
        if (currencyKey == pUSD) {
            return (debt, anyRateIsInvalid);
        }

        (uint currencyRate, bool currencyRateInvalid) = exchangeRates().rateAndInvalid(currencyKey);
        return (debt.divideDecimalRound(currencyRate), anyRateIsInvalid || currencyRateInvalid);
    }

    function _debtBalanceOfAndTotalDebt(address _issuer, bytes32 currencyKey)
        internal
        view
        returns (
            uint debtBalance,
            uint totalSystemValue,
            bool anyRateIsInvalid
        )
    {
        IPeriFinanceState state = periFinanceState();

        // What was their initial debt ownership?
        (uint initialDebtOwnership, uint debtEntryIndex) = state.issuanceData(_issuer);

        // What's the total value of the system excluding ETH backed pynths in their requested currency?
        (totalSystemValue, anyRateIsInvalid) = crossChainManager().currentNetworkAdaptedActiveDebtValue(currencyKey);

        // If it's zero, they haven't issued, and they have no debt.
        // Note: it's more gas intensive to put this check here rather than before _totalIssuedPynths
        // if they have 0 PERI, but it's a necessary trade-off
        if (initialDebtOwnership == 0) return (0, totalSystemValue, anyRateIsInvalid);

        // Figure out the global debt percentage delta from when they entered the system.
        // This is a high precision integer of 27 (1e27) decimals.
        uint _debtLedgerLength = state.debtLedgerLength();
        uint systemDebt = state.debtLedger(debtEntryIndex);
        uint currentDebtOwnership;
        if (_debtLedgerLength == 0 || systemDebt == 0) {
            currentDebtOwnership = 0;
        } else {
            currentDebtOwnership = state
                .lastDebtLedgerEntry()
                .divideDecimalRoundPrecise(systemDebt)
                .multiplyDecimalRoundPrecise(initialDebtOwnership);
        }

        // Their debt balance is their portion of the total system value.
        uint highPrecisionBalance =
            totalSystemValue.decimalToPreciseDecimal().multiplyDecimalRoundPrecise(currentDebtOwnership);

        // Convert back into 18 decimals (1e18)
        debtBalance = highPrecisionBalance.preciseDecimalToDecimal();
    }

    function _canBurnPynths(address account) internal view returns (bool) {
        return now >= _lastIssueEvent(account).add(getMinimumStakeTime()) && !crossChainManager().syncStale();
    }

    function _lastIssueEvent(address account) internal view returns (uint) {
        //  Get the timestamp of the last issue this account made
        return flexibleStorage().getUIntValue(CONTRACT_NAME, keccak256(abi.encodePacked(LAST_ISSUE_EVENT, account)));
    }

    function _remainingIssuablePynths(address _issuer)
        internal
        view
        returns (
            uint maxIssuable,
            uint alreadyIssued,
            uint totalSystemDebt,
            bool anyRateIsInvalid
        )
    {
        (alreadyIssued, totalSystemDebt, anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_issuer, pUSD);
        (uint issuable, bool isInvalid) = _maxIssuablePynths(_issuer);
        maxIssuable = issuable;
        anyRateIsInvalid = anyRateIsInvalid || isInvalid;

        if (alreadyIssued >= maxIssuable) {
            maxIssuable = 0;
        } else {
            maxIssuable = maxIssuable.sub(alreadyIssued);
        }
    }

    function _periToUSD(uint amount, uint periRate) internal pure returns (uint) {
        return amount.multiplyDecimalRound(periRate);
    }

    function _usdToPeri(uint amount, uint periRate) internal pure returns (uint) {
        return amount.divideDecimalRound(periRate);
    }

    function _maxIssuablePynths(address _issuer) internal view returns (uint maxIssuable, bool periRateIsInvalid) {
        // What is the value of their PERI balance in pUSD
        uint periRate;
        (periRate, periRateIsInvalid) = exchangeRates().rateAndInvalid(PERI);

        maxIssuable = _periToUSD(_collateral(_issuer), periRate)
            .add(exTokenStakeManager().combinedStakedAmountOf(_issuer, pUSD));

        // They're allowed to issue up to issuanceRatio of that value
        return (maxIssuable.multiplyDecimal(getIssuanceRatio()), periRateIsInvalid);
    }

    function _collateralisationRatio(address _issuer) internal view returns (uint, bool) {
        uint totalOwnedPeriFinance = _collateral(_issuer);
        uint externalTokenStaked = exTokenStakeManager().combinedStakedAmountOf(_issuer, PERI);

        (uint debtBalance, , bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_issuer, PERI);

        // it's more gas intensive to put this check here if they have 0 PERI, but it complies with the interface
        if (totalOwnedPeriFinance == 0 && externalTokenStaked == 0) return (0, anyRateIsInvalid);

        return (debtBalance.divideDecimal(totalOwnedPeriFinance.add(externalTokenStaked)), anyRateIsInvalid);
    }

    function _collateral(address account) internal view returns (uint) {
        uint balance = IERC20(address(periFinance())).balanceOf(account);

        if (address(periFinanceEscrow()) != address(0)) {
            balance = balance.add(periFinanceEscrow().balanceOf(account));
        }

        if (address(rewardEscrowV2()) != address(0)) {
            balance = balance.add(rewardEscrowV2().balanceOf(account));
        }

        return balance;
    }

    function _amountsToFitClaimable(
        uint _currentDebt,
        uint _stakedExTokenAmount,
        uint _periCollateral
    ) internal view returns (uint burnAmount, uint exTokenAmountToUnstake) {
        uint targetRatio = getIssuanceRatio();
        uint exTokenQuota = getExternalTokenQuota();

        uint initialCRatio = _currentDebt.divideDecimal(_stakedExTokenAmount.add(_periCollateral));
        // it doesn't satisfy target c-ratio
        if (initialCRatio > targetRatio) {
            uint maxAllowedExTokenStakeAmountByPeriCollateral =
                _periCollateral.multiplyDecimal(exTokenQuota.divideDecimal(SafeDecimalMath.unit().sub(exTokenQuota)));
            exTokenAmountToUnstake = _stakedExTokenAmount > maxAllowedExTokenStakeAmountByPeriCollateral
                ? _stakedExTokenAmount.sub(maxAllowedExTokenStakeAmountByPeriCollateral)
                : 0;
            burnAmount = _currentDebt.sub(
                _periCollateral.add(_stakedExTokenAmount).sub(exTokenAmountToUnstake).multiplyDecimal(targetRatio)
            );

            // it satisfies target c-ratio but violates external token quota
        } else {
            uint currentExTokenQuota = _stakedExTokenAmount.multiplyDecimal(targetRatio).divideDecimal(_currentDebt);
            require(currentExTokenQuota > exTokenQuota, "Account is already claimable");

            burnAmount = (_stakedExTokenAmount.multiplyDecimal(targetRatio).sub(_currentDebt.multiplyDecimal(exTokenQuota)))
                .divideDecimal(SafeDecimalMath.unit().sub(exTokenQuota));
            exTokenAmountToUnstake = burnAmount.divideDecimal(targetRatio);
        }
    }

    /**
     * @notice It calculates maximum issue/stake(external token) amount to meet external token quota limit.
     *
     * @param _from target address
     * @param _debtBalance current debt balance[pUSD]
     * @param _stakedAmount currently target address's external token staked amount[pUSD]
     * @param _currencyKey currency key of external token to stake
     */
    function _maxExternalTokenStakeAmount(
        address _from,
        uint _debtBalance,
        uint _stakedAmount,
        bytes32 _currencyKey
    ) internal view returns (uint issueAmount, uint stakeAmount) {
        // get TagetRatio and the Quota
        uint targetRatio = getIssuanceRatio();
        uint quotaLimit = getExternalTokenQuota();

        // calculate the debt amount of ex-token's to be staked
        // ex-token's debt = exsting debt * quota,
        // ex-token's staked value = ex-token's debt / target ratio
        // this code is for comparing current ex-token staked value to its max allowed staking value
        uint maxAllowedStakingAmount = _debtBalance.multiplyDecimal(quotaLimit).divideDecimal(targetRatio);

        // if ex-token quota is over, there is none additioinal debt nor stakable ex-tokens
        if (_stakedAmount >= maxAllowedStakingAmount) {
            return (0, 0);
        }

        // ex-token's stakable value derived from existing debt + the max quota debt
        stakeAmount = (maxAllowedStakingAmount.sub(_stakedAmount)).divideDecimal(SafeDecimalMath.unit().sub(quotaLimit));

        // we need to consider the decimals of the ex-token.
        uint tokenPUSDValue = exTokenStakeManager().getTokenPUSDValueOf(_from, _currencyKey);
        stakeAmount = tokenPUSDValue < stakeAmount ? tokenPUSDValue : stakeAmount;
        issueAmount = stakeAmount.multiplyDecimal(targetRatio);
    }

    function canBurnPynths(address account) external view returns (bool) {
        return _canBurnPynths(account);
    }

    function availableCurrencyKeys() external view returns (bytes32[] memory) {
        return _availableCurrencyKeysWithOptionalPERI(false);
    }

    function availablePynthCount() external view returns (uint) {
        return availablePynths.length;
    }

    function anyPynthOrPERIRateIsInvalid() external view returns (bool anyRateInvalid) {
        (, anyRateInvalid) = exchangeRates().ratesAndInvalidForCurrencies(_availableCurrencyKeysWithOptionalPERI(true));
    }

    function totalIssuedPynths(bytes32 currencyKey, bool excludeEtherCollateral)
        external
        view
        returns (uint totalIssued, bool anyRateIsInvalid)
    {
        (totalIssued, anyRateIsInvalid) = _totalIssuedPynths(currencyKey, excludeEtherCollateral);
    }

    function lastIssueEvent(address account) external view returns (uint) {
        return _lastIssueEvent(account);
    }

    function collateralisationRatio(address _issuer) external view returns (uint cratio) {
        (cratio, ) = _collateralisationRatio(_issuer);
    }

    function collateralisationRatioAndAnyRatesInvalid(address _issuer)
        external
        view
        returns (uint cratio, bool anyRateIsInvalid)
    {
        // [RC] When DebtCache is staled, the rate should be treated as invalid.
        (, , bool cacheIsInvalid, bool cacheIsStale) = debtCache().cacheInfo();

        (uint collarteralRatio, bool rateIsInvalid) = _collateralisationRatio(_issuer);

        anyRateIsInvalid = (cacheIsInvalid || cacheIsStale) ? true : anyRateIsInvalid || rateIsInvalid;
        cratio = collarteralRatio;
    }

    function collateral(address account) external view returns (uint) {
        return _collateral(account);
    }

    function debtBalanceOf(address _issuer, bytes32 currencyKey) external view returns (uint debtBalance) {
        IPeriFinanceState state = periFinanceState();

        // What was their initial debt ownership?
        (uint initialDebtOwnership, ) = state.issuanceData(_issuer);

        // If it's zero, they haven't issued, and they have no debt.
        if (initialDebtOwnership == 0) return 0;

        (debtBalance, , ) = _debtBalanceOfAndTotalDebt(_issuer, currencyKey);
    }

    function remainingIssuablePynths(address _issuer)
        external
        view
        returns (
            uint maxIssuable,
            uint alreadyIssued,
            uint totalSystemDebt
        )
    {
        (maxIssuable, alreadyIssued, totalSystemDebt, ) = _remainingIssuablePynths(_issuer);
    }

    function maxIssuablePynths(address _issuer) external view returns (uint) {
        (uint maxIssuable, ) = _maxIssuablePynths(_issuer);
        return maxIssuable;
    }

    function externalTokenQuota(
        address _account,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) external view returns (uint) {
        (uint debtBalance, , bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_account, pUSD);

        _requireRatesNotInvalid(anyRateIsInvalid);

        return
            exTokenStakeManager().externalTokenQuota(_account, debtBalance, _additionalpUSD, _additionalExToken, _isIssue);
    }

    function transferablePeriFinanceAndAnyRateIsInvalid(address account, uint balance)
        external
        view
        returns (uint transferable, bool anyRateIsInvalid)
    {
        // How many PERI do they have, excluding escrow?
        // Note: We're excluding escrow here because we're interested in their transferable amount
        // and escrowed PERI are not transferable.

        // How many of those will be locked by the amount they've issued?
        // Assuming issuance ratio is 20%, then issuing 20 PERI of value would require
        // 100 PERI to be locked in their wallet to maintain their collateralisation ratio
        // The locked periFinance value can exceed their balance.
        (uint debtBalance, , bool rateIsInvalid) = _debtBalanceOfAndTotalDebt(account, PERI);

        uint debtAppliedIssuanceRatio = debtBalance.divideDecimalRound(getIssuanceRatio());

        uint externalTokenStaked = exTokenStakeManager().combinedStakedAmountOf(account, PERI);

        // If external token staked balance is larger than required collateral amount for current debt,
        // no PERI would be locked. (But it violates external token staking quota rule)
        uint lockedPeriFinanceValue =
            debtAppliedIssuanceRatio > externalTokenStaked ? debtAppliedIssuanceRatio.sub(externalTokenStaked) : 0;

        // If we exceed the balance, no PERI are transferable, otherwise the difference is.
        if (lockedPeriFinanceValue < balance) {
            transferable = balance.sub(lockedPeriFinanceValue);
        }

        anyRateIsInvalid = rateIsInvalid;
    }

    function amountsToFitClaimable(address _account) external view returns (uint burnAmount, uint exTokenAmountToUnstake) {
        (uint debtBalance, , bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_account, pUSD);
        uint combinedStakedAmount = exTokenStakeManager().combinedStakedAmountOf(_account, pUSD);

        (uint periRate, bool isPeriInvalid) = exchangeRates().rateAndInvalid(PERI);
        uint periCollateralToUSD = _periToUSD(_collateral(_account), periRate);

        _requireRatesNotInvalid(anyRateIsInvalid || isPeriInvalid);

        (burnAmount, exTokenAmountToUnstake) = _amountsToFitClaimable(
            debtBalance,
            combinedStakedAmount,
            periCollateralToUSD
        );
    }

    function getPynths(bytes32[] calldata currencyKeys) external view returns (IPynth[] memory) {
        uint numKeys = currencyKeys.length;
        IPynth[] memory addresses = new IPynth[](numKeys);

        for (uint i; i < numKeys; i++) {
            addresses[i] = pynths[currencyKeys[i]];
        }

        return addresses;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function _addPynth(IPynth pynth) internal {
        bytes32 currencyKey = pynth.currencyKey();
        require(pynths[currencyKey] == IPynth(0), "Pynth exists");
        require(pynthsByAddress[address(pynth)] == bytes32(0), "Pynth address already exists");

        availablePynths.push(pynth);
        pynths[currencyKey] = pynth;
        pynthsByAddress[address(pynth)] = currencyKey;
    }

    // function addPynth(IPynth pynth) external onlyOwner {
    //     _addPynth(pynth);
    //     // Invalidate the cache to force a snapshot to be recomputed. If a pynth were to be added
    //     // back to the system and it still somehow had cached debt, this would force the value to be
    //     // updated.
    //     debtCache().updateDebtCacheValidity(true);
    // }

    function addPynths(IPynth[] calldata pynthsToAdd) external onlyOwner {
        uint numPynths = pynthsToAdd.length;
        for (uint i; i < numPynths; i++) {
            _addPynth(pynthsToAdd[i]);
        }

        // Invalidate the cache to force a snapshot to be recomputed.
        debtCache().updateDebtCacheValidity(true);
    }

    function _removePynth(bytes32 currencyKey) internal {
        address pynthToRemove = address(pynths[currencyKey]);
        require(pynthToRemove != address(0), "Pynth doesn't exist");
        require(IERC20(pynthToRemove).totalSupply() == 0, "Pynth supply exists");
        // require(currencyKey != pUSD, "Cannot remove pynth");

        // Remove the pynth from the availablePynths array.
        for (uint i; i < availablePynths.length; i++) {
            if (address(availablePynths[i]) == pynthToRemove) {
                delete availablePynths[i];

                // Copy the last pynth into the place of the one we just deleted
                // If there's only one pynth, this is pynths[0] = pynths[0].
                // If we're deleting the last one, it's also a NOOP in the same way.
                availablePynths[i] = availablePynths[availablePynths.length - 1];

                // Decrease the size of the array by one.
                availablePynths.length--;

                break;
            }
        }

        // And remove it from the pynths mapping
        delete pynthsByAddress[pynthToRemove];
        delete pynths[currencyKey];
    }

    function removePynth(bytes32 currencyKey) external onlyOwner {
        // Remove its contribution from the debt pool snapshot, and
        // invalidate the cache to force a new snapshot.
        IIssuerInternalDebtCache cache = debtCache();
        cache.updateCachedPynthDebtWithRate(currencyKey, 0);
        cache.updateDebtCacheValidity(true);

        _removePynth(currencyKey);
    }

    // function removePynths(bytes32[] calldata currencyKeys) external onlyOwner {
    //     uint numKeys = currencyKeys.length;

    //     // Remove their contributions from the debt pool snapshot, and
    //     // invalidate the cache to force a new snapshot.
    //     IIssuerInternalDebtCache cache = debtCache();
    //     uint[] memory zeroRates = new uint[](numKeys);
    //     cache.updateCachedPynthDebtsWithRates(currencyKeys, zeroRates);
    //     cache.updateDebtCacheValidity(true);

    //     for (uint i ; i < numKeys; i++) {
    //         _removePynth(currencyKeys[i]);
    //     }
    // }

    // function stake(
    //     address _staker,
    //     uint _amount,
    //     bytes32 _targetCurrency,
    //     bytes32 _inputCurrency
    // ) external {
    //     exTokenStakeManager().stake(_staker, _amount, _targetCurrency, _inputCurrency);
    // }
    //
    function issuePynths(
        address _issuer,
        bytes32 _currencyKey,
        uint _issueAmount
    ) external onlyPeriFinance {
        _requireCurrencyKeyIsNotpUSD(_currencyKey);

        if (_currencyKey != PERI) {
            uint amountToStake = _issueAmount.divideDecimalRound(getIssuanceRatio());

            (uint initialDebtOwnership, ) = periFinanceState().issuanceData(_issuer);
            // Condition of policy, user must have any amount of PERI locked before staking external token.
            _requireExistingDebt(initialDebtOwnership);

            exTokenStakeManager().stake(_issuer, amountToStake, _currencyKey, pUSD);
        }

        (uint maxIssuable, uint existingDebt, uint totalSystemDebt, bool anyRateIsInvalid) =
            _remainingIssuablePynths(_issuer);

        // USDC, DAI currency rate validation
        // bool rateIsInvalid = exchangeRates().rateIsInvalid(_currencyKey);

        // _requireRatesNotInvalid(anyRateIsInvalid||rateIsInvalid);
        _requireRatesNotInvalid(anyRateIsInvalid);

        uint afterDebtBalance = _issuePynths(_issuer, _issueAmount, maxIssuable, existingDebt, totalSystemDebt, false);

        // For preventing additional gas consumption by calculating debt twice, the quota checker is placed here.
        exTokenStakeManager().requireNotExceedsQuotaLimit(_issuer, afterDebtBalance, 0, 0, true);
    }

    function issueMaxPynths(address _issuer) external onlyPeriFinance {
        (uint maxIssuable, uint existingDebt, uint totalSystemDebt, bool anyRateIsInvalid) =
            _remainingIssuablePynths(_issuer);

        _requireRatesNotInvalid(anyRateIsInvalid);

        _issuePynths(_issuer, 0, maxIssuable, existingDebt, totalSystemDebt, true);
    }

    // function maxExternalTokenStakeAmount(
    //     address _from,
    //     uint _debtBalance,
    //     uint _stakedAmount,
    //     bytes32 _currencyKey
    // ) external view returns (uint issueAmount, uint stakeAmount) {
    //     return _maxExternalTokenStakeAmount(_from, _debtBalance, _stakedAmount, _currencyKey);
    // }

    // this senario only possible when prices of ex-token(stable coin) is down or staked debt from ex-token is not reache the quota.
    // leaving a room for extra debt.
    function issuePynthsToMaxQuota(address _issuer, bytes32 _currencyKey) external onlyPeriFinance {
        _requireCurrencyKeyIsNotpUSD(_currencyKey);
        require(_currencyKey != PERI, "Only external token allowed to stake");

        // get existing debt and total system debt
        (uint maxIssuable, uint existingDebt, uint totalSystemDebt, bool anyRateIsInvalid) =
            _remainingIssuablePynths(_issuer);
        _requireRatesNotInvalid(anyRateIsInvalid);
        _requireExistingDebt(existingDebt);

        // now get to-be-issued debt and to-be-staked amount of tokens
        uint combinedStakedAmount = exTokenStakeManager().combinedStakedAmountOf(_issuer, pUSD);
        (uint issueAmountToQuota, uint stakeAmountToQuota) =
            _maxExternalTokenStakeAmount(_issuer, existingDebt, combinedStakedAmount, _currencyKey);

        require(issueAmountToQuota > 0 && stakeAmountToQuota > 0, "Not available to stake");

        // stake more amount of ex-tokens
        exTokenStakeManager().stake(_issuer, stakeAmountToQuota, _currencyKey, pUSD);

        // maxIssuable should be increased for increased collateral
        maxIssuable = maxIssuable.add(issueAmountToQuota);

        uint afterDebtBalance = _issuePynths(_issuer, issueAmountToQuota, maxIssuable, existingDebt, totalSystemDebt, false);

        // For preventing additional gas consumption by calculating debt twice, the quota checker is placed here.
        exTokenStakeManager().requireNotExceedsQuotaLimit(_issuer, afterDebtBalance, 0, 0, true);
    }

    function burnPynths(
        address _from,
        bytes32 _currencyKey,
        uint _burnAmount
    ) external onlyPeriFinance {
        _requireCurrencyKeyIsNotpUSD(_currencyKey);

        if (_currencyKey == PERI) {
            exTokenStakeManager().requireNotExceedsQuotaLimit(
                _from,
                _voluntaryBurnPynths(_from, _burnAmount, false, false),
                0,
                0,
                false
            );
        } else {
            // [RC] when stable coins are burnt, the debt must be burnt as well
            _voluntaryBurnPynths(_from, _burnAmount, false, false);
            exTokenStakeManager().unstake(_from, _burnAmount.divideDecimalRound(getIssuanceRatio()), _currencyKey, pUSD);
        }
    }

    function fitToClaimable(address _from) external onlyPeriFinance {
        (uint debtBalance, , bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_from, pUSD);
        uint combinedStakedAmount = exTokenStakeManager().combinedStakedAmountOf(_from, pUSD);

        (uint periRate, bool isPeriInvalid) = exchangeRates().rateAndInvalid(PERI);

        _requireRatesNotInvalid(anyRateIsInvalid || isPeriInvalid);

        uint stakedAmount = _periToUSD(_collateral(_from), periRate);

        if (combinedStakedAmount.add(stakedAmount) == 0) {
            _voluntaryBurnPynths(_from, 0, true, true);
        } else {
            (uint burnAmount, uint amountToUnstake) =
                _amountsToFitClaimable(debtBalance, combinedStakedAmount, stakedAmount);

            _voluntaryBurnPynths(_from, burnAmount, true, false);

            exTokenStakeManager().unstakeMultipleTokens(_from, amountToUnstake, pUSD);
        }
    }

    function exit(address _from) external onlyPeriFinance {
        _voluntaryBurnPynths(_from, 0, false, true);

        exTokenStakeManager().exit(_from);
    }

    function liquidateDelinquentAccount(
        address account,
        uint pusdAmount,
        address liquidator
    ) external onlyPeriFinance returns (uint totalRedeemed, uint amountToLiquidate) {
        // Ensure waitingPeriod and pUSD balance is settled as burning impacts the size of debt pool
        require(!exchanger().hasWaitingPeriodOrSettlementOwing(liquidator, pUSD), "pUSD needs to be settled");

        // Check account is liquidation open
        // require(liquidations().isOpenForLiquidation(account), "Account not open for liquidation");  --> moved to liquidations().liquidateAccount()

        // require liquidator has enough pUSD
        require(IERC20(address(pynths[pUSD])).balanceOf(liquidator) >= pusdAmount, "Not enough pUSD");

        // What is their debt in pUSD?
        (uint debtBalance, uint totalDebtIssued, bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(account, pUSD);
        (uint periRate, bool periRateInvalid) = exchangeRates().rateAndInvalid(PERI);
        _requireRatesNotInvalid(anyRateIsInvalid || periRateInvalid);

        /*uint collateralForAccountinUSD = _periToUSD(IERC20(address(periFinance())).balanceOf(account), periRate);

        bytes32[] memory tokenList = exTokenStakeManager().getTokenList();
        for (uint i; i < tokenList.length; i++) {
            collateralForAccountinUSD = collateralForAccountinUSD.add(
                exTokenStakeManager().stakedAmountOf(account, tokenList[i], pUSD)
            );
        }

        uint amountToFixRatioinUSD = liquidations().calculateAmountToFixCollateral(debtBalance, collateralForAccountinUSD);

        // Cap amount to liquidate to repair collateral ratio based on issuance ratio
        amountToLiquidate = amountToFixRatioinUSD < pusdAmount ? amountToFixRatioinUSD : pusdAmount;

        // Add penalty
        uint totalRedeemedinUSD =
            amountToLiquidate.multiplyDecimal(SafeDecimalMath.unit().add(liquidations().liquidationPenalty()));

        if (totalRedeemedinUSD > collateralForAccountinUSD) {
            totalRedeemedinUSD = collateralForAccountinUSD;

            amountToLiquidate = collateralForAccountinUSD.divideDecimal(
                SafeDecimalMath.unit().add(liquidations().liquidationPenalty())
            );
        }

        totalRedeemedinUSD = exTokenStakeManager().redeem(account, totalRedeemedinUSD, liquidator);

        // what's the equivalent amount of peri for the amountToLiquidate?
        //uint periRedeemed = _usdToPeri(amountToLiquidate, periRate);
        totalRedeemed = _usdToPeri(totalRedeemedinUSD, periRate);

        // Remove liquidation flag if amount liquidated fixes ratio
        if (amountToLiquidate == amountToFixRatioinUSD) {
            // Remove liquidation
            liquidations().removeAccountInLiquidation(account);
        } */ //--> moved to liquidations().liquidateAccount()

        (totalRedeemed, amountToLiquidate) = liquidations().liquidateAccount(
            account,
            pusdAmount,
            debtBalance
        );

        totalRedeemed = exTokenStakeManager().redeem(account, totalRedeemed, liquidator);

        // what's the equivalent amount of peri for the amountToLiquidate?
        //uint periRedeemed = _usdToPeri(amountToLiquidate, periRate);
        totalRedeemed = _usdToPeri(totalRedeemed, periRate);

        // burn pUSD from messageSender (liquidator) and reduce account's debt
        _burnPynths(account, liquidator, amountToLiquidate, debtBalance, totalDebtIssued);
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _requireRatesNotInvalid(bool anyRateIsInvalid) internal pure {
        require(!anyRateIsInvalid, "A pynth or PERI rate is invalid");
    }

    function _requireCanIssueOnBehalf(address issueForAddress, address from) internal view {
        require(delegateApprovals().canIssueFor(issueForAddress, from), "Not approved to act on behalf");
    }

    function _requireCanBurnOnBehalf(address burnForAddress, address from) internal view {
        require(delegateApprovals().canBurnFor(burnForAddress, from), "Not approved to act on behalf");
    }

    function _requireCurrencyKeyIsNotpUSD(bytes32 _currencyKey) internal pure {
        require(_currencyKey != pUSD, "pUSD isn't stakable");
    }

    function _requireExistingDebt(uint existingDebt) internal pure {
        require(existingDebt > 0, "User has no debt");
    }

    function _issuePynths(
        address from,
        uint amount,
        uint maxIssuable,
        uint existingDebt,
        uint totalSystemDebt,
        bool issueMax
    ) internal returns (uint afterDebt) {
        if (!issueMax) {
            require(amount <= maxIssuable, "Amount too large");
        } else {
            amount = maxIssuable;
        }

        // Keep track of the debt they're about to create
        _addToDebtRegister(from, amount, existingDebt, totalSystemDebt);

        // record issue timestamp
        _setLastIssueEvent(from);

        // Create their pynths
        pynths[pUSD].issue(from, amount);

        // Account for the issued debt in the cache
        debtCache().updateCachedPynthDebtWithRate(pUSD, SafeDecimalMath.unit());

        // Store their locked PERI amount to determine their fee % for the period
        _appendAccountIssuanceRecord(from);

        afterDebt = existingDebt.add(amount);
    }

    function _burnPynths(
        address debtAccount,
        address burnAccount,
        uint amountBurnt,
        uint existingDebt,
        uint totalDebtIssued
    ) internal returns (uint) {
        // liquidation requires pUSD to be already settled / not in waiting period

        require(amountBurnt <= existingDebt, "Trying to burn more than debt");

        // Remove liquidated debt from the ledger
        _removeFromDebtRegister(debtAccount, amountBurnt, existingDebt, totalDebtIssued);

        uint pUSDBalance = IERC20(address(pynths[pUSD])).balanceOf(burnAccount);
        uint deviation = pUSDBalance < amountBurnt ? amountBurnt.sub(pUSDBalance) : pUSDBalance.sub(amountBurnt);

        // amountBurnt = deviation < 10 ? pUSDBalance : amountBurnt;
        if (deviation < 100) {
            amountBurnt = pUSDBalance;
        }

        require(amountBurnt <= pUSDBalance, "Trying to burn more than you have");

        // pynth.burn does a safe subtraction on balance (so it will revert if there are not enough pynths).
        pynths[pUSD].burn(burnAccount, amountBurnt);

        // Account for the burnt debt in the cache.
        debtCache().updateCachedPynthDebtWithRate(pUSD, SafeDecimalMath.unit());

        // Store their debtRatio against a fee period to determine their fee/rewards % for the period
        _appendAccountIssuanceRecord(debtAccount);

        return amountBurnt;
    }

    // If burning to target, `amount` is ignored, and the correct quantity of pUSD is burnt to reach the target
    // c-ratio, allowing fees to be claimed. In this case, pending settlements will be skipped as the user
    // will still have debt remaining after reaching their target.
    function _voluntaryBurnPynths(
        address from,
        uint amount,
        bool burnToTarget,
        bool burnMax
    ) internal returns (uint remainingDebt) {
        if (!burnToTarget) {
            // If not burning to target, then burning requires that the minimum stake time has elapsed.
            require(_canBurnPynths(from), "Min stake time not reached or chain sync stale");
            // First settle anything pending into pUSD as burning or issuing impacts the size of the debt pool
            (, uint refunded, uint numEntriesSettled) = exchanger().settle(from, pUSD);
            if (numEntriesSettled > 0) {
                amount = exchanger().calculateAmountAfterSettlement(from, pUSD, amount, refunded);
            }
        }

        (uint existingDebt, uint totalSystemValue, bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(from, pUSD);
        (uint maxIssuablePynthsForAccount, bool periRateInvalid) = _maxIssuablePynths(from);
        _requireRatesNotInvalid(anyRateIsInvalid || periRateInvalid);
        require(existingDebt > 0, "No debt to forgive");

        if (burnMax) {
            amount = existingDebt;
        }

        uint amountBurnt = _burnPynths(from, from, amount, existingDebt, totalSystemValue);
        remainingDebt = existingDebt.sub(amountBurnt);

        // Check and remove liquidation if existingDebt after burning is <= maxIssuablePynths
        // Issuance ratio is fixed so should remove any liquidations
        if (existingDebt >= amountBurnt && remainingDebt <= maxIssuablePynthsForAccount) {
            liquidations().removeAccountInLiquidation(from);
        }
    }

    function _setLastIssueEvent(address account) internal {
        // Set the timestamp of the last issuePynths
        flexibleStorage().setUIntValue(
            CONTRACT_NAME,
            keccak256(abi.encodePacked(LAST_ISSUE_EVENT, account)),
            block.timestamp
        );
    }

    function _appendAccountIssuanceRecord(address from) internal {
        uint initialDebtOwnership;
        uint debtEntryIndex;
        (initialDebtOwnership, debtEntryIndex) = periFinanceState().issuanceData(from);
        feePool().appendAccountIssuanceRecord(from, initialDebtOwnership, debtEntryIndex);
    }

    function _addToDebtRegister(
        address from,
        uint amount,
        uint existingDebt,
        uint totalDebtIssued
    ) internal {
        IPeriFinanceState state = periFinanceState();

        // What will the new total be including the new value?
        uint newTotalDebtIssued = amount.add(totalDebtIssued);

        // What is their percentage (as a high precision int) of the total debt?
        uint debtPercentage = amount.divideDecimalRoundPrecise(newTotalDebtIssued);

        // And what effect does this percentage change have on the global debt holding of other issuers?
        // The delta specifically needs to not take into account any existing debt as it's already
        // accounted for in the delta from when they issued previously.
        // The delta is a high precision integer.
        uint delta = SafeDecimalMath.preciseUnit().sub(debtPercentage);

        // And what does their debt ownership look like including this previous stake?
        if (existingDebt > 0) {
            debtPercentage = amount.add(existingDebt).divideDecimalRoundPrecise(newTotalDebtIssued);
        } else {
            // If they have no debt, they're a new issuer; record this.
            state.incrementTotalIssuerCount();
        }

        // Save the debt entry parameters
        state.setCurrentIssuanceData(from, debtPercentage);

        // doing nothing just left for version compatibility
        crossChainManager().addCurrentNetworkIssuedDebt(amount);

        // doing nothing just left for version compatibility
        // crossChainManager().setCrossNetworkUserDebt(from, state.debtLedgerLength());

        // And if we're the first, push 1 as there was no effect to any other holders, otherwise push
        // the change for the rest of the debt holders. The debt ledger holds high precision integers.
        if (state.debtLedgerLength() > 0 && state.lastDebtLedgerEntry() != 0) {
            state.appendDebtLedgerValue(state.lastDebtLedgerEntry().multiplyDecimalRoundPrecise(delta));
        } else {
            state.appendDebtLedgerValue(SafeDecimalMath.preciseUnit());
        }
    }

    function fixDebtRegister(
        uint prevLedgerValue,
        address from,
        uint amount,
        uint existingDebt,
        uint totalDebtIssued
    ) external onlyOwner {
        IPeriFinanceState state = periFinanceState();

        uint newTotalDebtIssued = amount.add(totalDebtIssued);

        uint debtPercentage = amount.divideDecimalRoundPrecise(newTotalDebtIssued);

        debtPercentage = amount.add(existingDebt).divideDecimalRoundPrecise(newTotalDebtIssued);

        state.setCurrentIssuanceData(from, debtPercentage);

        state.appendDebtLedgerValue(
            prevLedgerValue.multiplyDecimalRoundPrecise(SafeDecimalMath.preciseUnit().sub(debtPercentage))
        );

        _appendAccountIssuanceRecord(from);
    }

    function _removeFromDebtRegister(
        address from,
        uint debtToRemove,
        uint existingDebt,
        uint totalDebtIssued
    ) internal {
        IPeriFinanceState state = periFinanceState();

        // What will the new total after taking out the withdrawn amount
        uint newTotalDebtIssued = totalDebtIssued.sub(debtToRemove);

        uint delta;

        // What will the debt delta be if there is any debt left?
        // Set delta to 0 if no more debt left in system after user
        if (newTotalDebtIssued > 0) {
            // What is the percentage of the withdrawn debt (as a high precision int) of the total debt after?
            uint debtPercentage = debtToRemove.divideDecimalRoundPrecise(newTotalDebtIssued);

            // And what effect does this percentage change have on the global debt holding of other issuers?
            // The delta specifically needs to not take into account any existing debt as it's already
            // accounted for in the delta from when they issued previously.
            delta = SafeDecimalMath.preciseUnit().add(debtPercentage);
        }

        // Are they exiting the system, or are they just decreasing their debt position?
        if (debtToRemove == existingDebt) {
            state.setCurrentIssuanceData(from, 0);
            state.decrementTotalIssuerCount();

            // doing nothing just left for version compatibility
            // crossChainManager().clearCrossNetworkUserDebt(from);
        } else {
            // What percentage of the debt will they be left with?
            uint newDebt = existingDebt.sub(debtToRemove);
            uint newDebtPercentage = newDebt.divideDecimalRoundPrecise(newTotalDebtIssued);

            // Store the debt percentage and debt ledger as high precision integers
            state.setCurrentIssuanceData(from, newDebtPercentage);

            // doing nothing just left for version compatibility
            // crossChainManager().setCrossNetworkUserDebt(from, state.debtLedgerLength());
        }

        // update current network issued debt
        crossChainManager().subtractCurrentNetworkIssuedDebt(debtToRemove);

        // Update our cumulative ledger. This is also a high precision integer.
        state.appendDebtLedgerValue(state.lastDebtLedgerEntry().multiplyDecimalRoundPrecise(delta));
    }

    /* ========== MODIFIERS ========== */

    function _onlyPeriFinance() internal view {
        require(msg.sender == address(periFinance()), "Issuer: Only the periFinance contract can perform this action");
    }

    modifier onlyPeriFinance() {
        _onlyPeriFinance(); // Use an internal function to save code size.
        _;
    }
}
