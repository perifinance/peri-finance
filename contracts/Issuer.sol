pragma solidity 0.5.16;

// Inheritance
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./Owned.sol";
import "./SafeDecimalMath.sol";

import "./interfaces/ICollateralManager.sol";
import "./interfaces/ICrossChainManager.sol";
import "./interfaces/IDelegateApprovals.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IEtherCollateral.sol";
import "./interfaces/IEtherCollateralpUSD.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IExchanger.sol";
import "./interfaces/IExternalTokenStakeManager.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IHasBalance.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/ILiquidations.sol";
import "./interfaces/IPeriFinance.sol";
import "./interfaces/IPeriFinanceState.sol";
import "./interfaces/IPynth.sol";

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

    function exTokenManager() internal view returns (IExternalTokenStakeManager) {
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
        (totalSystemValue, anyRateIsInvalid) = crossChainManager().currentNetworkActiveDebtOf(currencyKey);

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
        return now >= _lastIssueEvent(account).add(getMinimumStakeTime()); /*  && !crossChainManager().syncStale() */
    }

    function _lastIssueEvent(address account) internal view returns (uint) {
        //  Get the timestamp of the last issue this account made
        return flexibleStorage().getUIntValue(CONTRACT_NAME, keccak256(abi.encodePacked(LAST_ISSUE_EVENT, account)));
    }

    function _remainingIssuablePynths(address _issuer)
        internal
        view
        returns (
            uint remainIssuable,
            uint alreadyIssued,
            uint totalSystemDebt
        )
    {
        // get issuer's debt, total system debt
        bool anyRateIsInvalid;
        (alreadyIssued, totalSystemDebt, anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_issuer, pUSD);
        _requireRatesNotInvalid(anyRateIsInvalid);

        // if it is ex-tokens, just retrun the debt balance, total system debt
        /* if (_currencyKey != PERI) {
            ( ,remainIssuable) = exTokenManager().maxStakableAmountOf(_issuer, alreadyIssued, _currencyKey, pUSD);
            remainIssuable = remainIssuable.multiplyDecimal(getExTokenIssuanceRatio(_currencyKey));
            return (remainIssuable, alreadyIssued, totalSystemDebt, anyRateIsInvalid);
        } */

        // get the max issuable debt by the account collateral value
        (remainIssuable, ) = _maxIssuablePynths(_issuer, alreadyIssued);

        // issuable debt based on the collateral's appreaciated value or the assets in stakable state
        remainIssuable = remainIssuable > alreadyIssued ? remainIssuable.sub(alreadyIssued) : 0;
    }

    function _preciseMulToDecimal(uint x, uint y) internal pure returns (uint) {
        return
            x.decimalToPreciseDecimal().multiplyDecimalRoundPrecise(y.decimalToPreciseDecimal()).preciseDecimalToDecimal();
    }

    function _preciseDivToDecimal(uint x, uint y) internal pure returns (uint) {
        return x.decimalToPreciseDecimal().divideDecimalRoundPrecise(y.decimalToPreciseDecimal()).preciseDecimalToDecimal();
    }

    function _toUSD(uint amount, uint rate) internal pure returns (uint) {
        return amount.multiplyDecimalRound(rate);
        // return _preciseMulToDecimal(amount, rate);
    }

    function _fromUSD(uint amount, uint rate) internal pure returns (uint) {
        return amount.divideDecimalRound(rate);
        // return _preciseDivToDecimal(amount, rate);
    }

    function _rateCheck(bytes32 _currencyKey) internal view returns (uint rate) {
        bool isInvalid;
        (rate, isInvalid) = exchangeRates().rateAndInvalid(_currencyKey);
        _requireRatesNotInvalid(isInvalid);
    }

    /* 
    function _toTRatio(uint _Tp, uint _Te, uint _Se) internal pure returns (uint) {
        // Target Ratio =  Peri Issuance Ratio - (Peri Issuance Ratio - Ex-Staking Ratio) * Ex-Staking Ratio
        (uint temp, bool sub) = _Tp > _Te ? (_Tp.sub(_Te), true) : (_Te.sub(_Tp), false);

        return sub ? _Tp.sub(_preciseMulToDecimal(temp, _Se)) : _Tp.add(_preciseMulToDecimal(temp, _Se));
    }
 */
    function _maxIssuablePynths(address _issuer, uint _existDebt) internal view returns (uint maxIssuable, uint tRatio) {
        // get the account's PERI balance
        uint periAmt = _toUSD(_collateral(_issuer), _rateCheck(PERI));

        // get external token's debt, staked amount and target ratio
        uint exEA;
        uint exDebt;
        (exDebt, exEA, tRatio) = exTokenManager().getExEADebt(_issuer);
        uint periIR = getIssuanceRatio();

        // calc max pUSD by the peri collateral
        periAmt = _preciseMulToDecimal(periAmt, periIR);

        // get maxIssuable pUSD amount
        maxIssuable = periAmt.add(exDebt);

        if (_existDebt > exDebt) {
            periAmt = _existDebt.sub(exDebt);
            periAmt = _preciseDivToDecimal(periAmt, periIR).add(exEA);
            periAmt = exEA.divideDecimal(periAmt);
        } else {
            periAmt = _existDebt > 0 ? SafeDecimalMath.unit() : 0;
        }

        // Target Ratio =  Peri Issuance Ratio + (exTRatio - Peri Issuance Ratio) * Ex-Staking Ratio
        tRatio = periAmt > 0 ? periIR.add(_preciseMulToDecimal(tRatio.sub(periIR), periAmt)) : 0;

        // get (periSA + exEA)
        // periAmt = _existDebt > maxIssuable
        //     ? _preciseDivToDecimal(_existDebt.sub(maxIssuable), getIssuanceRatio()).add(exEA)
        //     : _existDebt;

        // // Target Ratio =  Peri Issuance Ratio + (exTRatio - Peri Issuance Ratio) * Ex-Staking Ratio
        // tRatio = periAmt > 0
        //     ? getIssuanceRatio().add(
        //             _preciseMulToDecimal(tRatio.sub(getIssuanceRatio()), exEA.divideDecimal(periAmt))
        //         )
        //     : 0;
    }

    function _collateralisationRatio(address _issuer) internal view returns (uint cRatio, bool isInvalid) {
        uint exEA = exTokenManager().combinedStakedAmountOf(_issuer, pUSD);
        // (uint exDebt, uint exEA,) = exTokenManager().getExEADebt(_issuer);

        // get PERI's collateral amount
        uint periCol = _collateral(_issuer);

        // it's more gas intensive to put this check here if they have 0 PERI, but it complies with the interface
        if (periCol == 0 && exEA == 0) return (0, isInvalid);

        // get the account's debt balance
        bool anyRateIsInvalid;
        (cRatio, , anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_issuer, pUSD);

        // calc total staked amount
        // cRatio = _preciseDivToDecimal(cRatio.sub(exDebt), getIssuanceRatio()).add(exEA);

        uint rate;
        (rate, isInvalid) = exchangeRates().rateAndInvalid(PERI);
        isInvalid = anyRateIsInvalid || isInvalid;
        periCol = _toUSD(periCol, rate).add(exEA);

        cRatio = cRatio.divideDecimal(periCol);
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

    /**
     *
     * @param _from The address to issue pUSD.
     *
     * @return debt current debt balance
     * @return systemDebt current total system debt
     * @return periCol peri's collateral amount in pUSD
     */
    function _debtsCollateral(address _from, bool _isRateCheck)
        internal
        view
        returns (
            uint debt,
            uint systemDebt,
            uint periCol
        )
    {
        // get debt balance and issued debt
        bool anyRateIsInvalid;
        (debt, systemDebt, anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_from, pUSD);

        // get peri rate and check if it's invalid
        (uint rate, bool isInvalid) = exchangeRates().rateAndInvalid(PERI);
        if (_isRateCheck) _requireRatesNotInvalid(anyRateIsInvalid || isInvalid);

        // get PERI's collateral amount in pUSD
        periCol = _toUSD(_collateral(_from), rate);
    }

    // /**
    // * @notice It calculates the debt amount to burn and the ex-token amount to unstake to meet the target c-ratio
    // * @param _account target address
    // * @param _currentDebt current debt balance[pUSD]
    // * @param _periCollateral currently target address's peri collateral amount[pUSD]
    // */
    // function _amountsToFitClaimable(
    //     address _account,
    //     uint _currentDebt,
    //     // uint _exStakedAmt,
    //     uint _periCollateral
    // ) internal view returns (uint burnAmount, uint unstakeExAmt) {
    //     return exTokenManager().burnAmtToFitTR(_account, _currentDebt, _periCollateral, pUSD);
    //     // // get the taget c-ratio by the account
    //     // uint targetRatio = exTokenManager().getTargetRatio(_account); // getIssuanceRatio();
    //     // // get current c-ratio
    //     // uint initialCRatio = _currentDebt.divideDecimal(_exStakedAmt.add(_periCollateral));

    //     // // it doesn't satisfy target c-ratio
    //     // if (initialCRatio > targetRatio) {
    //     //     // uint maxExTokenAmount =
    //     //     //     _periCollateral.multiplyDecimal(exTokenQuota.divideDecimal(SafeDecimalMath.unit().sub(exTokenQuota)));
    //     //     (uint maxExAmount,) = exTokenManager().maxExAmtToTRatio(_account, _currentDebt, pUSD);

    //     //     // get the amount of ex-token to unstake to satisfy target c-ratio
    //     //     unstakeExAmt = _exStakedAmt > maxExAmount
    //     //         ? _exStakedAmt.sub(maxExAmount)
    //     //         : 0;

    //     //     // get the amount of debt to be burt to satisfy target c-ratio
    //     //     // debt amount to be burnt = current debt - (peri collateral + ex-staked amount - ex-unstake amount) * target ratio)
    //     //     burnAmount = _currentDebt.sub(
    //     //         _periCollateral.add(_exStakedAmt).sub(unstakeExAmt).decimalToPreciseDecimal().multiplyDecimalRoundPrecise(
    //     //             targetRatio
    //     //         ).preciseDecimalToDecimal()
    //     //     );

    //     //     // it satisfies target c-ratio but violates external token quota
    //     //     // just let it be claimable as long as it satisfies target c-ratio
    //     // } /* else {
    //     //     uint currentExTokenQuota = _exStakedAmt.multiplyDecimal(targetRatio).divideDecimal(_currentDebt);
    //     //     require(currentExTokenQuota > exTokenQuota, "Account is already claimable");

    //     //     burnAmount = (_exStakedAmt.multiplyDecimal(targetRatio).sub(_currentDebt.multiplyDecimal(exTokenQuota)))
    //     //         .divideDecimal(SafeDecimalMath.unit().sub(exTokenQuota));
    //     //     unstakeExAmt = burnAmount.divideDecimal(targetRatio);
    //     // } */
    // }

    // function _maxExternalTokenStakeAmount(
    //     address _account,
    //     uint _debtBalance,
    //     /* uint _stakedAmount, */
    //     bytes32 _currencyKey
    // ) internal view returns (uint stakeAmount) {
    //     // uint targetRatio = getIssuanceRatio();

    //     // get the taget c-ratio by the account
    //     // uint targetRatio = getExternalTokenQuota();
    //     // uint targetRatio = getIssuanceRatio();
    //     // uint quotaLimit = getExternalTokenQuota();

    //     // calculate max amount of ex-token to stake
    //     // ex-token's debt = exsting debt * quota,
    //     // ex-token's staked value = ex-token's debt / target ratio
    //     // this code is for comparing current ex-token staked value to its max allowed staking value
    //     // uint maxAmount = _debtBalance.multiplyDecimal(quotaLimit).divideDecimal(targetRatio);
    //     // returns(ex-tokens' max stakable amount for min Target Ratio, ex-tokens' stakeable amount to max Target Ratio in pUSD)
    //     (, stakeAmount) = exTokenManager().maxStakableAmountOf(_account, _debtBalance, _currencyKey, pUSD);

    //     // if ex-token quota is over, there is none additioinal debt nor stakable ex-tokens
    //     // already checked in maxStakableAmountOf()
    //     /* if (_stakedAmount >= issueAmount) {
    //         return (0, 0);
    //     } */

    //     // ex-token's stakable value derived from existing debt + the max quota debt
    //     // stakable ex-token value to meet quota limit = (max ex-quota debt - existing ex-debt) / (1 - ex-max-quota)
    //     // stakeAmount = (maxAmount.sub(_stakedAmount)).divideDecimal(SafeDecimalMath.unit().sub(quotaLimit));

    //     // we need to consider the decimals of the ex-token.
    //     // get all of _currencyKey token's amount of from the user wallet
    //     uint tokenPUSDValue = exTokenManager().getTokenPUSDValueOf(_account, _currencyKey);

    //     // cap the staking amount within the user's wallet amount
    //     stakeAmount = tokenPUSDValue < stakeAmount ? tokenPUSDValue : stakeAmount;

    //     // calculate the issuing debt amount
    //     stakeAmount = stakeAmount.multiplyDecimal(getExTokenIssuanceRatio(_currencyKey));
    // }

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

    function debtsCollateral(address _account, bool _checkRate)
        external
        view
        returns (
            uint debt,
            uint systemDebt,
            uint periCol
        )
    {
        return _debtsCollateral(_account, _checkRate);
    }

    function cRatioNDebtsCollateral(address _account)
        external
        view
        returns (
            uint tRatio,
            uint cRatio,
            uint exTRatio,
            uint exEA,
            uint debt,
            uint periCol
        )
    {
        // get debt
        (debt, , ) = _debtBalanceOfAndTotalDebt(_account, pUSD);

        // get peri rate and check if it's invalid
        (uint rate, ) = exchangeRates().rateAndInvalid(PERI);

        // get PERI's collateral amount in pUSD
        periCol = _collateral(_account);

        (tRatio, cRatio, exTRatio, exEA, , ) = exTokenManager().getRatios(_account, debt, _toUSD(periCol, rate));
    }

    function remainingIssuablePynths(
        address _issuer /* , bytes32 _currencyKey */
    )
        external
        view
        returns (
            uint maxIssuable,
            uint alreadyIssued,
            uint totalSystemDebt
        )
    {
        (maxIssuable, alreadyIssued, totalSystemDebt) = _remainingIssuablePynths(_issuer);
    }

    // function getAddDebtSA(address _issuer, uint _amount, bytes32 _currencyKey) external view returns (uint tRatio, uint addDebt, uint addableAmt) {
    //     // get the account's debt balance and peri collateral value
    //     (uint debtBalance,,uint periCAinUSD) = _debtsCollateral(_issuer/* , pUSD */);
    //     return exTokenManager().getAddDebtSA(_issuer, debtBalance, _amount, periCAinUSD, _currencyKey);
    // }

    function maxExIssuablePynths(address _issuer, bytes32 _currencyKey)
        external
        view
        returns (
            uint issuables /* , uint debtBalance */
        )
    {
        (uint debtBalance, , uint periCol) = _debtsCollateral(_issuer, true);
        (issuables) = exTokenManager().maxStakableAmountOf(_issuer, debtBalance, periCol, _currencyKey);
        issuables = issuables.multiplyDecimal(getExTokenIssuanceRatio(_currencyKey));
    }

    function maxIssuablePynths(address _issuer)
        external
        view
        returns (
            uint maxIssuable,
            uint tRatio,
            uint existDebt
        )
    {
        (existDebt, , ) = _debtBalanceOfAndTotalDebt(_issuer, pUSD);
        (maxIssuable, tRatio) = _maxIssuablePynths(_issuer, existDebt);
    }

    /* 
    function debtBalanceOfAndTotalDebt(address _issuer, bytes32 currencyKey)
        external
        view
        returns (
            uint debtBalance,
            uint totalSystemValue,
            bool anyRateIsInvalid
        )
    {
        (debtBalance, totalSystemValue, anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_issuer, currencyKey);
    } */

    /* function externalTokenQuota(
        address _account,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) external view returns (uint) {
        (uint debtBalance, , bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_account, pUSD);

        _requireRatesNotInvalid(anyRateIsInvalid);

        return
            exTokenManager().externalTokenQuota(_account, debtBalance, _additionalpUSD,  _additionalExToken, _isIssue);
    } */

    function getRatios(address _account, bool _checkRate)
        external
        view
        returns (
            uint tRatio,
            uint cRatio,
            uint exTRatio,
            uint exEA,
            uint exSR,
            uint maxSR
        )
    {
        (uint debtBalance, , uint periCol) = _debtsCollateral(_account, _checkRate);

        return exTokenManager().getRatios(_account, debtBalance, periCol);
    }

    function exStakingRatio(address _account)
        external
        view
        returns (
            uint exSR,
            uint maxSR,
            bool rateIsInvalid
        )
    {
        // uint rate; (rate, rateIsInvalid) = exchangeRates().rateAndInvalid(PERI);
        uint debtBalance;
        (debtBalance, , rateIsInvalid) = _debtBalanceOfAndTotalDebt(_account, pUSD);

        (exSR, maxSR) = exTokenManager().exStakingRatio(_account, debtBalance);
    }

    function getTargetRatio(address _account) external view returns (uint tRatio) {
        (uint debtBalance, , ) = _debtBalanceOfAndTotalDebt(_account, pUSD);

        (tRatio, , ) = exTokenManager().getTargetRatio(_account, debtBalance);
    }

    /* 
    function getTRatioCRatio(address _account)
        external
        view
        returns (
            uint tRatio,
            uint cRatio,
            uint exTRatio,
            uint exEA
        )
    {
        (uint debtBalance, , uint periCol) = _debtsCollateral(_account, false);

        (tRatio, cRatio, exTRatio, exEA) = exTokenManager().getTRatioCRatio(_account, debtBalance, periCol);
    } */

    function transferablePeriFinanceAndAnyRateIsInvalid(address account, uint balance)
        external
        view
        returns (uint transferable, bool anyRateIsInvalid)
    {
        // How many PERI do they have, excluding escrow?
        // Note: We're excluding escrow here because we're interested in their transferable amount
        // and escrowed PERI are not transferable.

        // How many of those will be locked by the amount they've issued?
        // Assuming issuance ratio is 20%, then issuing 20 pUSD would require
        // 100 PERI to be locked in their wallet to maintain their collateralisation ratio
        // The locked periFinance value can exceed their balance.
        uint debtBalance;
        (debtBalance, , anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(account, PERI);

        // get exDebt
        uint exDebt = exTokenManager().getExDebt(account);
        // calc peri debt = existDebt - exDebt
        exDebt = debtBalance > exDebt ? debtBalance.sub(exDebt) : 0;

        uint lockedPeriAmt = _preciseDivToDecimal(exDebt, getIssuanceRatio());

        // (uint exSA,) = exTokenManager().combinedStakedAmountOf(account, PERI);

        // If external token staked balance is larger than required collateral amount for current debt,
        // no PERI would be locked. (But it violates external token staking quota rule)
        // uint lockedPeriAmt = totalSA > exSA ? totalSA.sub(exSA) : 0;

        // If the locked value exceeds the balance, no PERI are transferable, otherwise the difference is.
        if (balance > lockedPeriAmt) {
            transferable = balance.sub(lockedPeriAmt);
        }

        // anyRateIsInvalid = rateIsInvalid;
    }

    function amountsToFitClaimable(address _account) external view returns (uint burnAmount, uint exRefundAmt) {
        // get the account's debt balance and peri collateral value
        (uint debtBalance, , uint periCAinUSD) = _debtsCollateral(_account, true);

        // get the amount of debt to be burnt and ex-token to be unstaked to satisfy target c-ratio
        (burnAmount, exRefundAmt, ) = exTokenManager().burnAmtToFitTR(_account, debtBalance, periCAinUSD);
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
    //     exTokenManager().stake(_staker, _amount, _targetCurrency, _inputCurrency);
    // }
    //
    function issuePynths(
        address _issuer,
        bytes32 _currencyKey,
        uint _issueAmount
    ) external onlyPeriFinance {
        _requireCurrencyKeyIsNotpUSD(_currencyKey);
        require(_issueAmount > 0, "Amount is zero");

        // validating rate of staking token such as PERI, USDC and DAI
        _requireRatesNotInvalid(exchangeRates().rateIsInvalid(_currencyKey));

        uint shyAmt;
        uint existingDebt;
        uint totalSystemDebt;
        // in case external token staking, let exTokenManager to proceed the staking
        // and readjust target ratio depending on the debt and estiamted ex-staked value
        if (_currencyKey != PERI) {
            // get issuer's debt, total system debt
            uint periCol;
            (existingDebt, totalSystemDebt, periCol) = _debtsCollateral(_issuer, true);

            // Condition of policy, user must have any amount of PERI locked before staking external token.
            _requireExistingDebt(existingDebt);

            // stake external token : the amount is to be taken cared of by exTokenManager
            shyAmt = exTokenManager().stake(_issuer, _issueAmount, existingDebt, periCol, _currencyKey, pUSD);

            // issue pUSD(debt)
            _issuePynths(
                _issuer,
                shyAmt,
                existingDebt,
                totalSystemDebt /* , false */
            );

            // in case of PERI and increasing debt is bigger than zero, which means initial staking, reset target ratio
        } else {
            // get issuable(needed) debt to meet the issuer's target ratio, existing debt and total system debt
            // uint tRatio; uint exTRatio;
            (shyAmt, existingDebt, totalSystemDebt) = _remainingIssuablePynths(_issuer);

            // get the increasing debt amount
            require(_issueAmount <= shyAmt, "Amount too large");

            // issue pUSD(debt)
            _issuePynths(_issuer, _issueAmount, existingDebt, totalSystemDebt);
        }
    }

    /**
     * @notice It issues pUSD to max debt to user by staking PERI only to meet target ratio. no change in target ratio.
     *
     * @param _issuer The address to issue pUSD.
     *
     */
    function issueMaxPynths(address _issuer) external onlyPeriFinance {
        (uint maxIssuable, uint existingDebt, uint totalSystemDebt) = _remainingIssuablePynths(_issuer);

        _issuePynths(
            _issuer,
            /*  0,  */
            maxIssuable,
            existingDebt,
            totalSystemDebt /* , true */
        );
    }

    // function maxExternalTokenStakeAmount(
    //     address _from,
    //     uint _debtBalance,
    //     uint _stakedAmount,
    //     bytes32 _currencyKey
    // ) external view returns (uint issueAmount, uint stakeAmount) {
    //     return _maxExternalTokenStakeAmount(_from, _debtBalance, _stakedAmount, _currencyKey);
    // }

    /**
     * @notice this senario only possible when prices of ex-token(stable coin) is down or staked debt from ex-token is not reached the quota.
     *          leaving a room for extra debt.
     *
     * @param _issuer The address to issue pUSD.
     * @param _currencyKey The currency key of external token to stake.
     *
     */
    function issuePynthsToMaxQuota(address _issuer, bytes32 _currencyKey) external onlyPeriFinance {
        _requireCurrencyKeyIsNotpUSD(_currencyKey);
        require(_currencyKey != PERI, "Only external token allowed to stake");

        // get existing debt and total system debt
        // (uint maxIssuable, uint existingDebt, uint totalSystemDebt, bool anyRateIsInvalid) =
        //     _remainingIssuablePynths(_issuer);

        // // get issuer's debt, total system debt
        // (uint existingDebt, uint totalSystemDebt, bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_issuer, pUSD);

        // // check if any rate is invalid
        // _requireRatesNotInvalid(anyRateIsInvalid);

        // get issuer's debt, total system debta and peri collateral amount
        (uint existingDebt, uint totalSystemDebt, uint periColAmt) = _debtsCollateral(_issuer, true);
        // check if existing debt is zero
        _requireExistingDebt(existingDebt);

        // // now get to-be-issued debt
        // (, uint addDebt) = exTokenManager().maxStakableAmountOf(_issuer, existingDebt, _currencyKey, pUSD);

        // require(addDebt > 0, "No available ex-tokens to stake");

        // // stake more amount of ex-tokens
        // addDebt = exTokenManager().stake(_issuer, existingDebt, addDebt, _currencyKey, pUSD);

        uint addDebt = exTokenManager().stakeToMaxExQuota(_issuer, existingDebt, periColAmt, _currencyKey);

        // in order to meet exIDebtToQ <= maxIssuable
        // maxIssuable = maxIssuable.add(exIDebtToQ);

        _issuePynths(
            _issuer,
            addDebt,
            /* maxIssuable,  */
            existingDebt,
            totalSystemDebt /* , false */
        );

        //// For preventing additional gas consumption by calculating debt twice, the quota checker is placed here.
        // exTokenManager().requireNotExceedsQuotaLimit(_issuer, afterDebtBalance, 0, 0, true);
    }

    function burnPynths(
        address _from,
        bytes32 _currencyKey,
        uint _burnAmount
    ) external onlyPeriFinance {
        _requireCurrencyKeyIsNotpUSD(_currencyKey);

        if (_currencyKey != PERI && _currencyKey != bytes32(0)) {
            // unstake ex-tokens.
            _unstakeExTokens(_from, _burnAmount, _currencyKey, false);
            return;
        }

        (uint debtBalance, uint systemDebt, bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_from, pUSD);
        _requireRatesNotInvalid(anyRateIsInvalid);

        // only burn ex-tokens
        if (_currencyKey == bytes32(0)) {
            // unstake ex-tokens. burning debt amount is reduced by the remained amount by unstaking ex-tokens
            _burnAmount = _burnAmount.sub(exTokenManager().proRataUnstake(_from, _burnAmount, pUSD));
        }
        // burn pUSD, get the target ratio and check liquidation
        debtBalance = _voluntaryBurnPynths(_from, _burnAmount, debtBalance, systemDebt, false);
        // check if the target ratio is satisfied
        require(
            _currencyKey != PERI || debtBalance.roundDownDecimal(uint(12)) <= getExternalTokenQuota(),
            "Over max external quota"
        );
    }

    // function _burnExPynths(address _from, uint _amount) internal {
    //     (uint debtBalance, uint systemDebt, bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_from, pUSD);
    //     _requireRatesNotInvalid(anyRateIsInvalid);

    //     // unstake ex-tokens.
    //     exTokenManager().proRataUnstake(_from, _amount, pUSD);

    //     // burn pUSD, set the target ratio and check liquidation
    //     _voluntaryBurnPynths(_from, _amount, debtBalance, systemDebt, false);
    // }

    /**
     * @notice It burns pUSD and unstakes ex-tokens to meet the condition
     *
     * @param _from the address to burn pUSD
     * @param _amount the amount of pUSD to burn
     * @param _currencyKey the currency key of ex-token to unstake
     * @param _fitToTRatio  if true, it burns pUSD and unstakes ex-tokens to meet the target ratio
     */
    function _unstakeExTokens(
        address _from,
        uint _amount,
        bytes32 _currencyKey,
        bool _fitToTRatio
    ) internal {
        // get debt balance and issued debt
        (uint debtBalance, uint systemDebt, uint periColAmt) = _debtsCollateral(_from, true);
        require(debtBalance > 0, "No debt to unstake");

        if (_fitToTRatio) {
            // get the amount of debt to be burnt and the amount of ex-token to be unstaked
            _amount = exTokenManager().unstakeToFitTR(_from, debtBalance, periColAmt);
        } else if (_currencyKey == bytes32(0)) {
            // unstake all ex-tokens
            exTokenManager().exit(_from);

            // set the burn amount = the debt balance
            _amount = debtBalance;
        } else {
            // unstake ex-tokens
            exTokenManager().unstake(_from, _amount, _currencyKey, pUSD);
        }

        // burn pUSD, set the target ratio and check liquidation
        _voluntaryBurnPynths(_from, _amount, debtBalance, systemDebt, _fitToTRatio);
    }

    /**
     * @notice It burns pUSD and unstakes ex-tokens to meet the target ratio
     *
     * @param _from The address to burn pUSD.
     */
    function fitToClaimable(address _from) external onlyPeriFinance {
        // unstake ex-tokens. pass PERI as _currencyKey since it's not used in the function
        _unstakeExTokens(_from, 0, PERI, true);
    }

    /**
     * @notice It burns as much as pUSD and unstakes all ex-tokens
     *
     * @param _from The address to burn pUSD.
     */
    function exit(address _from) external onlyPeriFinance {
        // unstake ex-tokens. pass '0' as _currencyKey for unstake as much as possible.
        _unstakeExTokens(_from, 0, bytes32(0), false);
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
        // (uint periRate, bool periRateInvalid) = exchangeRates().rateAndInvalid(PERI);
        _requireRatesNotInvalid(
            anyRateIsInvalid /*  || periRateInvalid */
        );

        /*uint collateralForAccountinUSD = _toUSD(IERC20(address(periFinance())).balanceOf(account), periRate);

        bytes32[] memory tokenList = exTokenManager().getTokenList();
        for (uint i; i < tokenList.length; i++) {
            collateralForAccountinUSD = collateralForAccountinUSD.add(
                exTokenManager().stakedAmountOf(account, tokenList[i], pUSD)
            );
        }

        uint amountToFixRatioinUSD = liquidations().calcAmtToFixCollateral(debtBalance, collateralForAccountinUSD);

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

        totalRedeemedinUSD = exTokenManager().redeem(account, totalRedeemedinUSD, liquidator);

        // what's the equivalent amount of peri for the amountToLiquidate?
        //uint periRedeemed = _usdToPeri(amountToLiquidate, periRate);
        totalRedeemed = _usdToPeri(totalRedeemedinUSD, periRate);

        // Remove liquidation flag if amount liquidated fixes ratio
        if (amountToLiquidate == amountToFixRatioinUSD) {
            // Remove liquidation
            liquidations().removeAccountInLiquidation(account);
        } */
        (totalRedeemed, amountToLiquidate) = liquidations().liquidateAccount(account, liquidator, pusdAmount, debtBalance);

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
        uint existingDebt,
        uint totalSystemDebt
    ) internal returns (uint afterDebt) {
        /*  if (!issueMax) {
            require(amount <= maxIssuable, "Amount too large");
        } else {
            amount = maxIssuable;
        } */

        if (amount == 0) {
            return existingDebt;
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
        require(amountBurnt <= existingDebt, "Trying to burn more than debt");

        // Remove liquidated debt from the ledger
        _removeFromDebtRegister(debtAccount, amountBurnt, existingDebt, totalDebtIssued);

        // get pUSD balance
        uint deviation;
        uint pUSDBalance = IERC20(address(pynths[pUSD])).balanceOf(burnAccount);

        // calc the deviation between pUSD balance and burnt amount
        deviation = amountBurnt > pUSDBalance ? amountBurnt.sub(pUSDBalance) : pUSDBalance.sub(amountBurnt);

        // if deviation is less than 10, burn all pUSD
        amountBurnt = deviation < 10 ? pUSDBalance : amountBurnt;

        // check if the account has enough pUSD to burn
        require(pUSDBalance >= amountBurnt, "Not enough pUSD to burn");

        // pynth.burn does a safe subtraction on balance (so it will revert if there are not enough pynths).
        pynths[pUSD].burn(burnAccount, amountBurnt);

        // Account for the burnt debt in the cache.
        debtCache().updateCachedPynthDebtWithRate(pUSD, SafeDecimalMath.unit());

        // Store their debtRatio against a fee period to determine their fee/rewards % for the period
        _appendAccountIssuanceRecord(debtAccount);

        return amountBurnt;
    }

    /**
     * @notice It burns debt, set target ratio and removes liquidation if existing debt after burning is <= maxIssuable
     *
     * @param from The address to burn pUSD.
     * @param amount The amount of pUSD to burn.
     * @param existingDebt The existing debt of the account.
     * @param totalSystemValue The total system value.
     * @param burnToTarget If true, burn pUSD to meet the target ratio.
     */
    function _voluntaryBurnPynths(
        address from,
        uint amount,
        uint existingDebt,
        uint totalSystemValue,
        bool burnToTarget
    ) internal returns (uint tRatio) {
        // get the max issuable debt based on the total collateral value
        require(existingDebt > 0, "No debt to forgive");

        if (!burnToTarget) {
            // If not burning to target, then burning requires that the minimum stake time has elapsed.
            require(_canBurnPynths(from), "Min stake time not reached or chain sync stale");
            // First settle anything pending into pUSD as burning or issuing impacts the size of the debt pool
            (, uint refunded, uint numEntriesSettled) = exchanger().settle(from, pUSD);
            if (numEntriesSettled > 0) {
                amount = exchanger().calculateAmountAfterSettlement(from, pUSD, amount, refunded);
            }
        }

        // burn pUSD from the _from account
        uint remainingDebt = _burnPynths(from, from, amount, existingDebt, totalSystemValue);
        remainingDebt = existingDebt.sub(remainingDebt);

        uint maxIssuable;
        (maxIssuable, tRatio) = _maxIssuablePynths(from, remainingDebt);

        // Check and remove liquidation if existingDebt after burning is <= maxIssuable
        // Issuance ratio is fixed so should remove any liquidations
        if (remainingDebt <= maxIssuable || remainingDebt.sub(maxIssuable) < 1e12) {
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
