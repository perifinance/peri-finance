pragma solidity ^0.5.16;

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
import "./interfaces/IStakingStateUSDC.sol";

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
    bytes32 internal constant USDC = "USDC";

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
    bytes32 private constant CONTRACT_USDC = "USDC";
    bytes32 private constant CONTRACT_STAKINGSTATE_USDC = "StakingStateUSDC";

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
        newAddresses[13] = CONTRACT_USDC;
        newAddresses[14] = CONTRACT_STAKINGSTATE_USDC;
        return combineArrays(existingAddresses, newAddresses);
    }

    function periFinance() internal view returns (IPeriFinance) {
        return IPeriFinance(requireAndGetAddress(CONTRACT_PERIFINANCE));
    }

    function stakingStateUSDC() internal view returns (IStakingStateUSDC) {
        return IStakingStateUSDC(requireAndGetAddress(CONTRACT_STAKINGSTATE_USDC));
    }

    function usdc() internal view returns (IERC20) {
        return IERC20(requireAndGetAddress(USDC));
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

    function issuanceRatio() external view returns (uint) {
        return getIssuanceRatio();
    }

    function _availableCurrencyKeysWithOptionalPERI(bool withPERI) internal view returns (bytes32[] memory) {
        bytes32[] memory currencyKeys = new bytes32[](availablePynths.length + (withPERI ? 1 : 0));

        for (uint i = 0; i < availablePynths.length; i++) {
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
        anyRateIsInvalid = cacheIsInvalid || cacheIsStale;

        IExchangeRates exRates = exchangeRates();

        // Add total issued pynths from non peri collateral back into the total if not excluded
        if (!excludeCollateral) {
            // Get the pUSD equivalent amount of all the MC issued pynths.
            (uint nonPeriDebt, bool invalid) = collateralManager().totalLong();
            debt = debt.add(nonPeriDebt);
            anyRateIsInvalid = anyRateIsInvalid || invalid;

            // Now add the ether collateral stuff as we are still supporting it.
            debt = debt.add(etherCollateralpUSD().totalIssuedPynths());

            // Add ether collateral pETH
            (uint ethRate, bool ethRateInvalid) = exRates.rateAndInvalid(pETH);
            uint ethIssuedDebt = etherCollateral().totalIssuedPynths().multiplyDecimalRound(ethRate);
            debt = debt.add(ethIssuedDebt);
            anyRateIsInvalid = anyRateIsInvalid || ethRateInvalid;
        }

        if (currencyKey == pUSD) {
            return (debt, anyRateIsInvalid);
        }

        (uint currencyRate, bool currencyRateInvalid) = exRates.rateAndInvalid(currencyKey);
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
        (totalSystemValue, anyRateIsInvalid) = _totalIssuedPynths(currencyKey, true);

        // If it's zero, they haven't issued, and they have no debt.
        // Note: it's more gas intensive to put this check here rather than before _totalIssuedPynths
        // if they have 0 PERI, but it's a necessary trade-off
        if (initialDebtOwnership == 0) return (0, totalSystemValue, anyRateIsInvalid);

        // Figure out the global debt percentage delta from when they entered the system.
        // This is a high precision integer of 27 (1e27) decimals.
        uint _debtLedgerLength = state.debtLedgerLength();
        uint systemDebt = state.debtLedger(debtEntryIndex);
        uint currentDebtOwnership;
        if (_debtLedgerLength <= 0 || systemDebt == 0) {
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
        return now >= _lastIssueEvent(account).add(getMinimumStakeTime());
    }

    function _currentUSDCDebtQuota(address _account) internal view returns (uint, bool) {
        (uint debtBalance, , bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_account, pUSD);

        uint usdcStakedAmount = stakingStateUSDC().stakedAmountOf(_account);
        if (usdcStakedAmount == 0 || debtBalance == 0) {
            return (0, anyRateIsInvalid);
        }

        (uint usdcRate, bool isUSDCInvalid) = exchangeRates().rateAndInvalid(USDC);
        uint usdcStakedAmountToUSD = _usdcToUSD(usdcStakedAmount, usdcRate);
        uint debtByUSDC = usdcStakedAmountToUSD.multiplyDecimalRound(getIssuanceRatio());

        return (debtByUSDC.divideDecimalRound(debtBalance), anyRateIsInvalid || isUSDCInvalid);
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

    function _usdcToUSD(uint _amount, uint _usdcRate) internal pure returns (uint) {
        if (_amount == 0) return 0;

        return _amount.multiplyDecimalRound(_usdcRate);
    }

    function _usdToUSDC(uint _amount, uint _usdcRate) internal pure returns (uint) {
        if (_amount == 0) return 0;

        return _amount.divideDecimalRound(_usdcRate);
    }

    function _maxIssuablePynths(address _issuer) internal view returns (uint, bool) {
        // What is the value of their PERI balance in pUSD
        (uint periRate, bool anyRateIsInvalid) = exchangeRates().rateAndInvalid(PERI);
        uint periCollateral = _periToUSD(_collateral(_issuer), periRate);

        uint usdcStakedAmountToUSD;
        if (stakingStateUSDC().hasStaked(_issuer)) {
            (uint usdcRate, bool isUSDCInvalid) = exchangeRates().rateAndInvalid(USDC);
            usdcStakedAmountToUSD = _usdcToUSD(stakingStateUSDC().stakedAmountOf(_issuer), usdcRate);

            anyRateIsInvalid = anyRateIsInvalid || isUSDCInvalid;
        }

        uint destinationValue = periCollateral.add(usdcStakedAmountToUSD);

        // They're allowed to issue up to issuanceRatio of that value
        return (destinationValue.multiplyDecimal(getIssuanceRatio()), anyRateIsInvalid);
    }

    function _collateralisationRatio(address _issuer) internal view returns (uint, bool) {
        uint totalOwnedPeriFinance = _collateral(_issuer);

        (uint debtBalance, , bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_issuer, PERI);

        uint usdcStakedAmountToPeri;
        bool rateIsInvalid;
        uint usdcStakedAmount = stakingStateUSDC().stakedAmountOf(_issuer);
        if (usdcStakedAmount > 0) {
            (uint usdcRate, bool isUSDCInvalid) = exchangeRates().rateAndInvalid(USDC);
            uint usdcStakedAmountToUSD = _usdcToUSD(usdcStakedAmount, usdcRate);
            (uint periRate, bool isPeriInvalid) = exchangeRates().rateAndInvalid(PERI);
            usdcStakedAmountToPeri = _usdToPeri(usdcStakedAmountToUSD, periRate);

            rateIsInvalid = rateIsInvalid || isUSDCInvalid || isPeriInvalid;
        }

        // it's more gas intensive to put this check here if they have 0 PERI, but it complies with the interface
        rateIsInvalid = rateIsInvalid || anyRateIsInvalid;
        if (totalOwnedPeriFinance == 0 && usdcStakedAmount == 0) return (0, rateIsInvalid);

        uint totalOwned = totalOwnedPeriFinance.add(usdcStakedAmountToPeri);

        return (debtBalance.divideDecimal(totalOwned), rateIsInvalid);
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
        uint _stakedUSDCAmount,
        uint _periCollateral
    ) internal view returns (uint burnAmount, uint usdcAmountToUnstake) {
        uint targetRatio = getIssuanceRatio();
        uint usdcQuota = getUSDCQuota();

        uint initialCRatio = _currentDebt.divideDecimal(_stakedUSDCAmount.add(_periCollateral));
        // it doesn't satisfy target c-ratio
        if (initialCRatio > targetRatio) {
            uint maxAllowedUSDCStakeAmountByPeriCollateral =
                _periCollateral.multiplyDecimal(usdcQuota.divideDecimal(SafeDecimalMath.unit().sub(usdcQuota)));
            usdcAmountToUnstake = _stakedUSDCAmount > maxAllowedUSDCStakeAmountByPeriCollateral
                ? _stakedUSDCAmount.sub(maxAllowedUSDCStakeAmountByPeriCollateral)
                : 0;
            burnAmount = _currentDebt.sub(
                _periCollateral.add(_stakedUSDCAmount).sub(usdcAmountToUnstake).multiplyDecimal(targetRatio)
            );

            // it satisfies target c-ratio but violates USDC quota
        } else {
            uint currentUSDCQuota = _stakedUSDCAmount.multiplyDecimal(targetRatio).divideDecimal(_currentDebt);
            require(currentUSDCQuota.div(10**12).mul(10**12) > usdcQuota, "Account is already claimable");

            burnAmount = (_stakedUSDCAmount.multiplyDecimal(targetRatio).sub(_currentDebt.multiplyDecimal(usdcQuota)))
                .divideDecimal(SafeDecimalMath.unit().sub(usdcQuota));
            usdcAmountToUnstake = burnAmount.divideDecimal(targetRatio);
        }
    }

    function minimumStakeTime() external view returns (uint) {
        return getMinimumStakeTime();
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

    function totalIssuedPynths(bytes32 currencyKey, bool excludeEtherCollateral) external view returns (uint totalIssued) {
        (totalIssued, ) = _totalIssuedPynths(currencyKey, excludeEtherCollateral);
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
        return _collateralisationRatio(_issuer);
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
        uint debtBalance;
        bool rateIsInvalid;
        (debtBalance, , rateIsInvalid) = _debtBalanceOfAndTotalDebt(account, PERI);

        uint lockedPeriFinanceValue;

        if (stakingStateUSDC().hasStaked(account)) {
            (uint usdcRate, bool isUSDCInvalid) = exchangeRates().rateAndInvalid(USDC);
            uint usdcStakedAmountToUSD = _usdcToUSD(stakingStateUSDC().stakedAmountOf(account), usdcRate);
            uint debtByUSDC = usdcStakedAmountToUSD.multiplyDecimalRound(getIssuanceRatio());

            (uint periRate, bool isPeriInvalid) = exchangeRates().rateAndInvalid(PERI);
            uint debtByUSDCToPeri = _usdToPeri(debtByUSDC, periRate);

            if (debtBalance > debtByUSDCToPeri) {
                uint debtBalanceWithoutUSDC = debtBalance.sub(debtByUSDCToPeri);

                lockedPeriFinanceValue = debtBalanceWithoutUSDC.divideDecimalRound(getIssuanceRatio());
            } else {
                lockedPeriFinanceValue = 0;
            }

            anyRateIsInvalid = rateIsInvalid || isUSDCInvalid || isPeriInvalid;
        } else {
            lockedPeriFinanceValue = debtBalance.divideDecimalRound(getIssuanceRatio());

            anyRateIsInvalid = rateIsInvalid;
        }

        // If we exceed the balance, no PERI are transferable, otherwise the difference is.
        if (lockedPeriFinanceValue >= balance) {
            transferable = 0;
        } else {
            transferable = balance.sub(lockedPeriFinanceValue);
        }
    }

    function getPynths(bytes32[] calldata currencyKeys) external view returns (IPynth[] memory) {
        uint numKeys = currencyKeys.length;
        IPynth[] memory addresses = new IPynth[](numKeys);

        for (uint i = 0; i < numKeys; i++) {
            addresses[i] = pynths[currencyKeys[i]];
        }

        return addresses;
    }

    function currentUSDCDebtQuota(address _account) external view returns (uint) {
        (uint usdcDebtQuota, bool anyRateIsInvalid) = _currentUSDCDebtQuota(_account);

        _requireRatesNotInvalid(anyRateIsInvalid);

        return usdcDebtQuota;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function _addPynth(IPynth pynth) internal {
        bytes32 currencyKey = pynth.currencyKey();
        require(pynths[currencyKey] == IPynth(0), "Pynth exists");
        require(pynthsByAddress[address(pynth)] == bytes32(0), "Pynth address already exists");

        availablePynths.push(pynth);
        pynths[currencyKey] = pynth;
        pynthsByAddress[address(pynth)] = currencyKey;

        emit PynthAdded(currencyKey, address(pynth));
    }

    function addPynth(IPynth pynth) external onlyOwner {
        _addPynth(pynth);
        // Invalidate the cache to force a snapshot to be recomputed. If a pynth were to be added
        // back to the system and it still somehow had cached debt, this would force the value to be
        // updated.
        debtCache().updateDebtCacheValidity(true);
    }

    function addPynths(IPynth[] calldata pynthsToAdd) external onlyOwner {
        uint numPynths = pynthsToAdd.length;
        for (uint i = 0; i < numPynths; i++) {
            _addPynth(pynthsToAdd[i]);
        }

        // Invalidate the cache to force a snapshot to be recomputed.
        debtCache().updateDebtCacheValidity(true);
    }

    function _removePynth(bytes32 currencyKey) internal {
        address pynthToRemove = address(pynths[currencyKey]);
        require(pynthToRemove != address(0), "Pynth does not exist");
        require(IERC20(pynthToRemove).totalSupply() == 0, "Pynth supply exists");
        require(currencyKey != pUSD, "Cannot remove pynth");

        // Remove the pynth from the availablePynths array.
        for (uint i = 0; i < availablePynths.length; i++) {
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

        emit PynthRemoved(currencyKey, pynthToRemove);
    }

    function removePynth(bytes32 currencyKey) external onlyOwner {
        // Remove its contribution from the debt pool snapshot, and
        // invalidate the cache to force a new snapshot.
        IIssuerInternalDebtCache cache = debtCache();
        cache.updateCachedPynthDebtWithRate(currencyKey, 0);
        cache.updateDebtCacheValidity(true);

        _removePynth(currencyKey);
    }

    function removePynths(bytes32[] calldata currencyKeys) external onlyOwner {
        uint numKeys = currencyKeys.length;

        // Remove their contributions from the debt pool snapshot, and
        // invalidate the cache to force a new snapshot.
        IIssuerInternalDebtCache cache = debtCache();
        uint[] memory zeroRates = new uint[](numKeys);
        cache.updateCachedPynthDebtsWithRates(currencyKeys, zeroRates);
        cache.updateDebtCacheValidity(true);

        for (uint i = 0; i < numKeys; i++) {
            _removePynth(currencyKeys[i]);
        }
    }

    function issuePynthsAndStakeUSDC(
        address _issuer,
        uint _issueAmount,
        uint _usdcStakeAmount
    ) external onlyPeriFinance {
        _issuePynthsAndStakeUSDC(_issuer, _issueAmount, _usdcStakeAmount, false);
    }

    function issuePynthsAndStakeMaxUSDC(address _issuer, uint _issueAmount) external onlyPeriFinance {
        _issuePynthsAndStakeUSDC(_issuer, _issueAmount, 0, true);
    }

    function issueMaxPynths(address _issuer) external onlyPeriFinance {
        _issuePynths(_issuer, 0, true);
    }

    function burnPynthsAndUnstakeUSDC(
        address _from,
        uint _burnAmount,
        uint _unstakeAmount
    ) external onlyPeriFinance {
        _burnPynthsAndUnstakeUSDC(_from, _burnAmount, _unstakeAmount);
    }

    function burnPynthsAndUnstakeUSDCToTarget(address _from) external onlyPeriFinance {
        (uint debtBalance, , bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_from, pUSD);

        (uint usdcRate, bool isUSDCInvalid) = exchangeRates().rateAndInvalid(USDC);
        uint usdcStakedAmountToUSD = _usdcToUSD(stakingStateUSDC().stakedAmountOf(_from), usdcRate);

        (uint periRate, bool isPeriInvalid) = exchangeRates().rateAndInvalid(PERI);
        uint periCollateralToUSD = _periToUSD(_collateral(_from), periRate);

        _requireRatesNotInvalid(anyRateIsInvalid || isUSDCInvalid || isPeriInvalid);

        (uint burnAmount, uint usdcAmountToUnstake) =
            _amountsToFitClaimable(debtBalance, usdcStakedAmountToUSD, periCollateralToUSD);

        _burnPynthsAndUnstakeUSDC(_from, burnAmount, _usdToUSDC(usdcAmountToUnstake, usdcRate));
    }

    function liquidateDelinquentAccount(
        address account,
        uint pusdAmount,
        address liquidator
    ) external onlyPeriFinance returns (uint totalRedeemed, uint amountToLiquidate) {
        // Ensure waitingPeriod and pUSD balance is settled as burning impacts the size of debt pool
        require(!exchanger().hasWaitingPeriodOrSettlementOwing(liquidator, pUSD), "pUSD needs to be settled");

        // Check account is liquidation open
        require(liquidations().isOpenForLiquidation(account), "Account not open for liquidation");

        // require liquidator has enough pUSD
        require(IERC20(address(pynths[pUSD])).balanceOf(liquidator) >= pusdAmount, "Not enough pUSD");

        uint liquidationPenalty = liquidations().liquidationPenalty();

        // What is their debt in pUSD?
        (uint debtBalance, uint totalDebtIssued, bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(account, pUSD);
        (uint periRate, bool periRateInvalid) = exchangeRates().rateAndInvalid(PERI);
        _requireRatesNotInvalid(anyRateIsInvalid || periRateInvalid);

        uint collateralForAccount = _collateral(account);
        uint amountToFixRatio =
            liquidations().calculateAmountToFixCollateral(debtBalance, _periToUSD(collateralForAccount, periRate));

        // Cap amount to liquidate to repair collateral ratio based on issuance ratio
        amountToLiquidate = amountToFixRatio < pusdAmount ? amountToFixRatio : pusdAmount;

        // what's the equivalent amount of peri for the amountToLiquidate?
        uint periRedeemed = _usdToPeri(amountToLiquidate, periRate);

        // Add penalty
        totalRedeemed = periRedeemed.multiplyDecimal(SafeDecimalMath.unit().add(liquidationPenalty));

        // if total PERI to redeem is greater than account's collateral
        // account is under collateralised, liquidate all collateral and reduce pUSD to burn
        if (totalRedeemed > collateralForAccount) {
            // set totalRedeemed to all transferable collateral
            totalRedeemed = collateralForAccount;

            // whats the equivalent pUSD to burn for all collateral less penalty
            amountToLiquidate = _periToUSD(
                collateralForAccount.divideDecimal(SafeDecimalMath.unit().add(liquidationPenalty)),
                periRate
            );
        }

        // burn pUSD from messageSender (liquidator) and reduce account's debt
        _burnPynths(account, liquidator, amountToLiquidate, debtBalance, totalDebtIssued);

        // Remove liquidation flag if amount liquidated fixes ratio
        if (amountToLiquidate == amountToFixRatio) {
            // Remove liquidation
            liquidations().removeAccountInLiquidation(account);
        }
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

    function _issuePynths(
        address from,
        uint amount,
        bool issueMax
    ) internal {
        (uint maxIssuable, uint existingDebt, uint totalSystemDebt, bool anyRateIsInvalid) = _remainingIssuablePynths(from);
        _requireRatesNotInvalid(anyRateIsInvalid);

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
    }

    function _issuePynthsAndStakeUSDC(
        address _issuer,
        uint _issueAmount,
        uint _usdcStakeAmount,
        bool _stakeMax
    ) internal {
        if (_stakeMax || _usdcStakeAmount > 0) {
            (uint debtBalance, , ) = _debtBalanceOfAndTotalDebt(_issuer, pUSD);

            uint afterDebtBalanceWithIssuanceRatio = debtBalance.add(_issueAmount).divideDecimalRound(getIssuanceRatio());

            (uint usdcRate, ) = exchangeRates().rateAndInvalid(USDC);
            require(
                _issueAmount >= _usdcToUSD(_usdcStakeAmount, usdcRate).multiplyDecimalRound(getIssuanceRatio()),
                "Staking amount exceeds issueing amount"
            );

            uint maxUSDCQuotaAfterIssue =
                _usdToUSDC(afterDebtBalanceWithIssuanceRatio, usdcRate).multiplyDecimalRound(getUSDCQuota());
            uint userStakedAmount = stakingStateUSDC().stakedAmountOf(_issuer);

            require(maxUSDCQuotaAfterIssue > userStakedAmount, "No availalbe USDC staking amount remains");

            uint availableUSDCAmountToStake = maxUSDCQuotaAfterIssue.sub(userStakedAmount);
            if (_stakeMax) {
                uint usdcBalance = usdc().balanceOf(_issuer).mul(10**12);
                _usdcStakeAmount = usdcBalance >= availableUSDCAmountToStake ? availableUSDCAmountToStake : usdcBalance;
            } else {
                require(availableUSDCAmountToStake >= _usdcStakeAmount, "Input amount exceeds available staking amount");
            }

            _transferAndStakeUSDC(_issuer, _usdcStakeAmount);
        }

        _issuePynths(_issuer, _issueAmount, false);

        _parsingUSDCStakingAmount(_issuer);
    }

    function _transferAndStakeUSDC(address _account, uint _amount) internal {
        require(
            usdc().transferFrom(_account, address(stakingStateUSDC()), _amount.div(10**12)),
            "transferring USDC has been failed"
        );

        stakingStateUSDC().stake(_account, _amount);
    }

    /**
     * @dev refund() adjusts decimals 18 to 6
     * @param _amount 18 decimals USDC amount to unstake and refund
     */
    function _unstakeAndRefundUSDC(address _account, uint _amount) internal {
        stakingStateUSDC().unstake(_account, _amount);

        require(stakingStateUSDC().refund(_account, _amount), "refunding USDC has been failed");
    }

    function _parsingUSDCStakingAmount(address _account)
    internal {
        uint stakedAmountAfterIssue = stakingStateUSDC().stakedAmountOf(_account);
        uint stakedAmountToParse = stakedAmountAfterIssue.sub(stakedAmountAfterIssue.div(10**12).mul(10**12));
        if(stakedAmountToParse > 0) {
            stakingStateUSDC().unstake(_account, stakedAmountToParse);
        }
    }

    function _burnPynths(
        address debtAccount,
        address burnAccount,
        uint amount,
        uint existingDebt,
        uint totalDebtIssued
    ) internal returns (uint amountBurnt) {
        // liquidation requires pUSD to be already settled / not in waiting period

        // If they're trying to burn more debt than they actually owe, rather than fail the transaction, let's just
        // clear their debt and leave them be.
        amountBurnt = existingDebt < amount ? existingDebt : amount;

        uint usdcStakedAmount = stakingStateUSDC().stakedAmountOf(debtAccount);
        if (usdcStakedAmount > 0) {
            (uint usdcRate, bool isUSDCInvalid) = exchangeRates().rateAndInvalid(USDC);

            _requireRatesNotInvalid(isUSDCInvalid);

            uint usdcStakedAmountToUSDWithIssuanceRatio =
                _usdcToUSD(usdcStakedAmount, usdcRate).multiplyDecimalRound(getIssuanceRatio());

            require(
                existingDebt.sub(amountBurnt) >= usdcStakedAmountToUSDWithIssuanceRatio,
                "Burn amount exceeds available amount"
            );
        }

        // Remove liquidated debt from the ledger
        _removeFromDebtRegister(debtAccount, amountBurnt, existingDebt, totalDebtIssued);

        // pynth.burn does a safe subtraction on balance (so it will revert if there are not enough pynths).
        pynths[pUSD].burn(burnAccount, amountBurnt);

        // Account for the burnt debt in the cache.
        debtCache().updateCachedPynthDebtWithRate(pUSD, SafeDecimalMath.unit());

        // Store their debtRatio against a fee period to determine their fee/rewards % for the period
        _appendAccountIssuanceRecord(debtAccount);
    }

    // If burning to target, `amount` is ignored, and the correct quantity of pUSD is burnt to reach the target
    // c-ratio, allowing fees to be claimed. In this case, pending settlements will be skipped as the user
    // will still have debt remaining after reaching their target.
    function _voluntaryBurnPynths(
        address from,
        uint amount,
        bool burnToTarget
    ) internal {
        if (!burnToTarget) {
            // If not burning to target, then burning requires that the minimum stake time has elapsed.
            require(_canBurnPynths(from), "Minimum stake time not reached");
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

        if (burnToTarget) {
            amount = existingDebt.sub(maxIssuablePynthsForAccount);
        }

        uint amountBurnt = _burnPynths(from, from, amount, existingDebt, totalSystemValue);

        // Check and remove liquidation if existingDebt after burning is <= maxIssuablePynths
        // Issuance ratio is fixed so should remove any liquidations
        if (existingDebt >= amountBurnt && existingDebt.sub(amountBurnt) <= maxIssuablePynthsForAccount) {
            liquidations().removeAccountInLiquidation(from);
        }
    }

    function _burnPynthsAndUnstakeUSDC(
        address _from,
        uint _burnAmount,
        uint _unstakeAmount
    ) internal {
        if (_unstakeAmount > 0) {
            (uint usdcRate, bool isUSDCInvalid) = exchangeRates().rateAndInvalid(USDC);

            _requireRatesNotInvalid(isUSDCInvalid);

            uint unstakeAmountToUSDWithIssuanceRatio =
                _usdcToUSD(_unstakeAmount, usdcRate).multiplyDecimal(getIssuanceRatio());

            require(_burnAmount >= unstakeAmountToUSDWithIssuanceRatio, "Unstake amount exceeds burn amount");

            _unstakeAndRefundUSDC(_from, _unstakeAmount);
        }

        _voluntaryBurnPynths(_from, _burnAmount, false);

        _parsingUSDCStakingAmount(_from);

        (uint usdcQuota, ) = _currentUSDCDebtQuota(_from);

        require(usdcQuota <= getUSDCQuota(), "USDC staked exceeds quota");
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

        // And if we're the first, push 1 as there was no effect to any other holders, otherwise push
        // the change for the rest of the debt holders. The debt ledger holds high precision integers.
        if (state.debtLedgerLength() > 0 && state.lastDebtLedgerEntry() != 0) {
            state.appendDebtLedgerValue(state.lastDebtLedgerEntry().multiplyDecimalRoundPrecise(delta));
        } else {
            state.appendDebtLedgerValue(SafeDecimalMath.preciseUnit());
        }
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

        uint delta = 0;

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
        } else {
            // What percentage of the debt will they be left with?
            uint newDebt = existingDebt.sub(debtToRemove);
            uint newDebtPercentage = newDebt.divideDecimalRoundPrecise(newTotalDebtIssued);

            // Store the debt percentage and debt ledger as high precision integers
            state.setCurrentIssuanceData(from, newDebtPercentage);
        }

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

    /* ========== EVENTS ========== */

    event PynthAdded(bytes32 currencyKey, address pynth);
    event PynthRemoved(bytes32 currencyKey, address pynth);
}