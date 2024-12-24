pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/IIssuer.sol";

// Libraries
import "./SafeCast.sol";
import "./SafeDecimalMath.sol";

// Internal references
import "./interfaces/IPynth.sol";
import "./interfaces/IPeriFinanceDebtShare.sol";
import "./interfaces/IExchanger.sol";
import "./interfaces/ICrossChainManager.sol";
import "./interfaces/IDelegateApprovals.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/ICircuitBreaker.sol";
import "./interfaces/IExternalTokenStakeManager.sol";
import "./interfaces/IHasBalance.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/ILiquidations.sol";
import "./interfaces/ISystemStatus.sol";
import "./Proxyable.sol";

import "@chainlink/contracts-0.0.10/src/v0.5/interfaces/AggregatorV2V3Interface.sol";

interface IProxy {
    function target() external view returns (address);
}

interface IIssuerInternalDebtCache {
    function updateCachedPynthDebtWithRate(bytes32 currencyKey, uint currencyRate) external;

    function updateCachedPynthDebtsWithRates(bytes32[] calldata currencyKeys, uint[] calldata currencyRates) external;

    function updateDebtCacheValidity(bool currentlyInvalid) external;

    function totalNonPeriBackedDebt() external view returns (uint excludedDebt, bool isInvalid);

    function cacheInfo()
        external
        view
        returns (
            uint cachedDebt,
            uint timestamp,
            bool isInvalid,
            bool isStale
        );

    function updateCachedpUSDDebt(int amount) external;
}

// https://docs.peri.finance/contracts/source/contracts/issuer
contract Issuer is Owned, MixinSystemSettings, IIssuer {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    bytes32 public constant CONTRACT_NAME = "Issuer";

    // Available Pynths which can be used with the system
    IPynth[] public availablePynths;
    mapping(bytes32 => IPynth) public pynths;
    mapping(address => bytes32) public pynthsByAddress;

    /* ========== ENCODED NAMES ========== */

    bytes32 internal constant pUSD = "pUSD";
    bytes32 internal constant pETH = "pETH";
    bytes32 internal constant PERI = "PERI";

    // Flexible storage names

    bytes32 internal constant LAST_ISSUE_EVENT = "lastIssueEvent";

    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_PERIFINANCE = "PeriFinance";
    bytes32 private constant CONTRACT_EXCHANGER = "Exchanger";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";
    bytes32 private constant CONTRACT_CIRCUIT_BREAKER = "CircuitBreaker";
    bytes32 private constant CONTRACT_FEEPOOL = "FeePool";
    bytes32 private constant CONTRACT_DELEGATEAPPROVALS = "DelegateApprovals";
    bytes32 private constant CONTRACT_REWARDESCROW_V2 = "RewardEscrowV2";
    bytes32 private constant CONTRACT_LIQUIDATIONS = "Liquidations";

    bytes32 private constant CONTRACT_DEBTCACHE = "DebtCache";
    bytes32 private constant CONTRACT_EXTOKENSTAKEMANAGER = "ExternalTokenStakeManager";
    bytes32 private constant CONTRACT_CROSSCHAINMANAGER = "CrossChainManager";
    bytes32 private constant CONTRACT_SYNTHREDEEMER = "PynthRedeemer";
    bytes32 private constant CONTRACT_PERIFINANCEBRIDGETOOPTIMISM = "PeriFinanceBridgeToOptimism";

    bytes32 private constant CONTRACT_EXT_AGGREGATOR_ISSUED_PYNTHS = "ext:AggregatorIssuedPynths";
    bytes32 private constant CONTRACT_EXT_AGGREGATOR_DEBT_RATIO = "ext:AggregatorDebtRatio";
    bytes32 private constant CONTRACT_PERIFINANCEDEBTSHARE = "PeriFinanceDebtShare";

    constructor(address _owner, address _resolver) public Owned(_owner) MixinSystemSettings(_resolver) {}

    /* ========== VIEWS ========== */
    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](16);
        newAddresses[0] = CONTRACT_PERIFINANCE;
        newAddresses[1] = CONTRACT_EXCHANGER;
        newAddresses[2] = CONTRACT_EXRATES;
        newAddresses[3] = CONTRACT_FEEPOOL;
        newAddresses[4] = CONTRACT_DELEGATEAPPROVALS;
        newAddresses[5] = CONTRACT_REWARDESCROW_V2;
        newAddresses[6] = CONTRACT_LIQUIDATIONS;
        newAddresses[7] = CONTRACT_DEBTCACHE;
        newAddresses[8] = CONTRACT_EXTOKENSTAKEMANAGER;
        newAddresses[9] = CONTRACT_CROSSCHAINMANAGER;
        newAddresses[10] = CONTRACT_CIRCUIT_BREAKER;
        newAddresses[11] = CONTRACT_EXT_AGGREGATOR_ISSUED_PYNTHS;
        newAddresses[12] = CONTRACT_EXT_AGGREGATOR_DEBT_RATIO;
        newAddresses[13] = CONTRACT_SYNTHREDEEMER;
        newAddresses[14] = CONTRACT_PERIFINANCEBRIDGETOOPTIMISM;
        newAddresses[15] = CONTRACT_PERIFINANCEDEBTSHARE;
        // newAddresses[18] = CONTRACT_ETHERCOLLATERAL;
        // newAddresses[19] = CONTRACT_ETHERCOLLATERAL_PUSD;
        // newAddresses[20] = CONTRACT_PERIFINANCEESCROW;
        // newAddresses[21] = CONTRACT_COLLATERALMANAGER;
        
        return combineArrays(existingAddresses, newAddresses);
    }

  function periFinanceERC20() internal view returns (IERC20) {
        return IERC20(requireAndGetAddress(CONTRACT_PERIFINANCE));
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

    function circuitBreaker() internal view returns (ICircuitBreaker) {
        return ICircuitBreaker(requireAndGetAddress(CONTRACT_CIRCUIT_BREAKER));
    }


    function liquidations() internal view returns (ILiquidations) {
        return ILiquidations(requireAndGetAddress(CONTRACT_LIQUIDATIONS));
    }

    function delegateApprovals() internal view returns (IDelegateApprovals) {
        return IDelegateApprovals(requireAndGetAddress(CONTRACT_DELEGATEAPPROVALS));
    }

    function rewardEscrowV2() internal view returns (IHasBalance) {
        return IHasBalance(requireAndGetAddress(CONTRACT_REWARDESCROW_V2));
    }

    function debtCache() internal view returns (IIssuerInternalDebtCache) {
        return IIssuerInternalDebtCache(requireAndGetAddress(CONTRACT_DEBTCACHE));
    }

    function periFinanceDebtShare() internal view returns (IPeriFinanceDebtShare) {
        return IPeriFinanceDebtShare(requireAndGetAddress(CONTRACT_PERIFINANCEDEBTSHARE));
    }

    function allNetworksDebtInfo()
        public
        view
        returns (
            uint256 debt,
            uint256 sharesSupply,
            bool isStale
        )
    {
        (, int256 rawIssuedPynths, , uint issuedPynthsUpdatedAt, ) =
            _latestRoundData(requireAndGetAddress(CONTRACT_EXT_AGGREGATOR_ISSUED_PYNTHS));

        (uint rawRatio, uint ratioUpdatedAt) = _rawDebtRatioAndUpdatedAt();

        debt = uint(rawIssuedPynths);
        sharesSupply = rawRatio == 0 ? 0 : debt.divideDecimalRoundPrecise(uint(rawRatio));

        uint stalePeriod = getRateStalePeriod();

        isStale =
            stalePeriod < block.timestamp &&
            (block.timestamp - stalePeriod > issuedPynthsUpdatedAt || block.timestamp - stalePeriod > ratioUpdatedAt);
    }

    function issuanceRatio() external view returns (uint) {
        return getIssuanceRatio();
    }

    function _rateAndInvalid(bytes32 currencyKey) internal view returns (uint, bool) {
        return exchangeRates().rateAndInvalid(currencyKey);
    }

    function _latestRoundData(address aggregator)
        internal
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return AggregatorV2V3Interface(aggregator).latestRoundData();
    }

    function _rawDebtRatioAndUpdatedAt() internal view returns (uint, uint) {
        (, int256 rawRatioInt, , uint ratioUpdatedAt, ) =
            _latestRoundData(requireAndGetAddress(CONTRACT_EXT_AGGREGATOR_DEBT_RATIO));
        return (uint(rawRatioInt), ratioUpdatedAt);
    }

    function _sharesForDebt(uint debtAmount) internal view returns (uint) {
        (uint rawRatio, ) = _rawDebtRatioAndUpdatedAt();
        return rawRatio == 0 ? 0 : debtAmount.divideDecimalRoundPrecise(rawRatio);
    }

    function _debtForShares(uint sharesAmount) internal view returns (uint) {
        (uint rawRatio, ) = _rawDebtRatioAndUpdatedAt();
        return sharesAmount.multiplyDecimalRoundPrecise(rawRatio);
    }

    function _periBalanceOf(address account) internal view returns (uint) {
        return periFinanceERC20().balanceOf(account);
    }

    function _rewardEscrowBalanceOf(address account) internal view returns (uint) {
        return rewardEscrowV2().balanceOf(account);
    }

    function crossChainManager() internal view returns (ICrossChainManager) {
        return ICrossChainManager(requireAndGetAddress(CONTRACT_CROSSCHAINMANAGER));
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

        // Add total issued pynths from non peri collateral back into the total if not excluded
        if (!excludeCollateral) {
            (uint nonSnxDebt, bool invalid) = debtCache().totalNonPeriBackedDebt();

            debt = debt.add(nonSnxDebt);
            anyRateIsInvalid = anyRateIsInvalid || invalid;
        }

        if (currencyKey == pUSD) {
            return (debt, anyRateIsInvalid);
        }

        (uint currencyRate, bool currencyRateInvalid) = _rateAndInvalid(currencyKey);
        return (debt.divideDecimalRound(currencyRate), anyRateIsInvalid || currencyRateInvalid);
    }

    function _debtBalanceOfAndTotalDebt(uint debtShareBalance, bytes32 currencyKey)
        internal
        view
        returns (
            uint debtBalance,
            uint totalSystemValue,
            bool anyRateIsInvalid
        )
    {

       (uint periBackedAmount, , bool debtInfoStale) = allNetworksDebtInfo();

        // What was their initial debt ownership?
        //(uint initialDebtOwnership, uint debtEntryIndex) = state.issuanceData(_issuer);


        // What's the total value of the system excluding ETH backed pynths in their requested currency?
        //(totalSystemValue, anyRateIsInvalid) = crossChainManager().currentNetworkActiveDebtOf(currencyKey);
        (totalSystemValue,) = crossChainManager().currentNetworkActiveDebtOf(currencyKey);


        // existing functionality requires for us to convert into the exchange rate specified by `currencyKey`
        (uint currencyRate, bool currencyRateInvalid) = _rateAndInvalid(currencyKey);

        //require(anyRateIsInvalid == false, "Rates are invalid1");

        anyRateIsInvalid = currencyRateInvalid || debtInfoStale;


        debtBalance = _debtForShares(debtShareBalance).divideDecimalRound(currencyRate);
        totalSystemValue = periBackedAmount;
    }
    
  function _debtShareBalanceOf(address account) internal view returns (uint) {
        return periFinanceDebtShare().balanceOf(account);
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
        (alreadyIssued, totalSystemDebt, anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(_issuer), pUSD);
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

    function _periToUSD(uint amount, uint periRate) internal pure returns (uint) {
        return amount.multiplyDecimalRound(periRate);
    }


        function _usdToSnx(uint amount, uint periRate) internal pure returns (uint) {
        return amount.divideDecimalRound(periRate);
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

    // function _maxIssuablePynths(address _issuer) internal view returns (uint, bool) {
    //     // What is the value of their PERI balance in pUSD
    //     (uint periRate, bool isInvalid) = _rateAndInvalid(PERI);
    //     uint destinationValue = _periToUSD(_collateral(_issuer), periRate);

    //     // They're allowed to issue up to issuanceRatio of that value
    //     return (destinationValue.multiplyDecimal(getIssuanceRatio()), isInvalid);
    // }

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
        } 
        else {
            periAmt = _existDebt > 0 ? SafeDecimalMath.unit() : 0;
        }

        // Target Ratio =  Peri Issuance Ratio + (exTRatio - Peri Issuance Ratio) * Ex-Staking Ratio
        tRatio = periAmt > 0 ? periIR.add(_preciseMulToDecimal(tRatio.sub(periIR), periAmt)) : 0;
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
        (cRatio, , anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(_issuer), pUSD);

        // calc total staked amount
        // cRatio = _preciseDivToDecimal(cRatio.sub(exDebt), getIssuanceRatio()).add(exEA);

        uint rate;
        (rate, isInvalid) = exchangeRates().rateAndInvalid(PERI);
        isInvalid = anyRateIsInvalid || isInvalid;
        periCol = _toUSD(periCol, rate).add(exEA);

        cRatio = cRatio.divideDecimal(periCol);
    }

        function _collateral(address account) internal view returns (uint) {
        uint balance = IERC20(requireAndGetAddress(CONTRACT_PERIFINANCE)).balanceOf(account);

        // if (address(periFinanceEscrow()) != address(0)) {
        //     balance = balance.add(periFinanceEscrow().balanceOf(account));
        // }

        if (address(rewardEscrowV2()) != address(0)) {
            balance = balance.add(rewardEscrowV2().balanceOf(account));
        }

        return balance;
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
        (debt, systemDebt, anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(_from), pUSD);

        // get peri rate and check if it's invalid
       (uint rate, bool isInvalid) = exchangeRates().rateAndInvalid(PERI);
        if (_isRateCheck) _requireRatesNotInvalid(anyRateIsInvalid || isInvalid);

        // get PERI's collateral amount in pUSD
        periCol = _toUSD(_collateral(_from), rate);
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

    function totalIssuedPynths(bytes32 currencyKey, bool excludeEtherCollateral)
        external
        view
        returns (uint totalIssued)
    {
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
 
        (debtBalance, , ) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(_issuer), currencyKey);
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
        (maxIssuable, alreadyIssued, totalSystemDebt) = _remainingIssuablePynths(_issuer);
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
        (debtBalance, , anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(account), PERI);

        uint lockedPeriFinanceValue = debtBalance.divideDecimalRound(getIssuanceRatio());

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

    /// @notice Provide the results that would be returned by the mutative liquidateAccount() method (that's reserved to PeriFinance)
    /// @param account The account to be liquidated
    /// @param isSelfLiquidation boolean to determine if this is a forced or self-invoked liquidation
    /// @return totalRedeemed the total amount of collateral (PERI) to redeem (liquid and escrow)
    /// @return debtToRemove the amount of debt (pUSD) to burn in order to fix the account's c-ratio
    /// @return escrowToLiquidate the amount of escrow PERI that will be revoked during liquidation
    /// @return initialDebtBalance the amount of initial (pUSD) debt the account has
    function liquidationAmounts(address account, bool isSelfLiquidation)
        external
        view
        returns (
            uint totalRedeemed,
            uint debtToRemove,
            uint escrowToLiquidate,
            uint initialDebtBalance
        )
    {
        return _liquidationAmounts(account, isSelfLiquidation);
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
        require(currencyKey != pUSD, "Cannot remove pynth");

        uint pynthSupply = IERC20(pynthToRemove).totalSupply();

        if (pynthSupply > 0) {
            (uint amountOfpUSD, uint rateToRedeem, ) =
                exchangeRates().effectiveValueAndRates(currencyKey, pynthSupply, "pUSD");
            require(rateToRedeem > 0, "Cannot remove without rate");
            // ensure the debt cache is aware of the new pUSD issued
            debtCache().updateCachedpUSDDebt(SafeCast.toInt256(amountOfpUSD));
        }

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

    function issuePynthsWithoutDebt(
        bytes32 currencyKey,
        address to,
        uint amount
    ) external onlyTrustedMinters returns (bool) {
        require(address(pynths[currencyKey]) != address(0), "pynth doesn't exist");
        require(amount > 0, "cannot issue 0 pynths");

        // record issue timestamp
        _setLastIssueEvent(to);

        // Create their pynths
        pynths[currencyKey].issue(to, amount);

        // Account for the issued debt in the cache
        (uint rate, bool rateInvalid) = _rateAndInvalid(currencyKey);
        debtCache().updateCachedpUSDDebt(SafeCast.toInt256(amount.multiplyDecimal(rate)));

        return rateInvalid;
    }

    function burnPynthsWithoutDebt(
        bytes32 currencyKey,
        address from,
        uint amount
    ) external onlyTrustedMinters returns (bool) {
        require(address(pynths[currencyKey]) != address(0), "pynth doesn't exist");
        require(amount > 0, "cannot issue 0 pynths");

        exchanger().settle(from, currencyKey);

        // Burn some pynths
        pynths[currencyKey].burn(from, amount);

        // Account for the burnt debt in the cache. If rate is invalid, the user won't be able to exchange
        (uint rate, bool rateInvalid) = _rateAndInvalid(currencyKey);
        debtCache().updateCachedpUSDDebt(-SafeCast.toInt256(amount.multiplyDecimal(rate)));

        // returned so that the caller can decide what to do if the rate is invalid
        return rateInvalid;
    }

 function issuePynths(address _issuer, bytes32 _currencyKey, uint _issueAmount) external onlyPeriFinance {
        require(_issueAmount > 0, "cannot issue 0 pynths");

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
                existingDebt
            );

            // in case of PERI and increasing debt is bigger than zero, which means initial staking, reset target ratio
        } else {
            // get issuable(needed) debt to meet the issuer's target ratio, existing debt and total system debt
            // uint tRatio; uint exTRatio;
            (shyAmt, existingDebt, totalSystemDebt) = _remainingIssuablePynths(_issuer);

            // get the increasing debt amount
            require(_issueAmount <= shyAmt, "Amount too large");

            // issue pUSD(debt)
            _issuePynths(_issuer, _issueAmount, existingDebt);
        }


    }

    function issueMaxPynths(address _issuer) external onlyPeriFinance {
          (uint maxIssuable, uint existingDebt,) = _remainingIssuablePynths(_issuer);

        _issuePynths(
            _issuer,
            /*  0,  */
            maxIssuable,
            existingDebt
        );
    }
    

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
        (uint existingDebt, , uint periColAmt) = _debtsCollateral(_issuer, true);
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
            existingDebt
        );

        //// For preventing additional gas consumption by calculating debt twice, the quota checker is placed here.
        // exTokenManager().requireNotExceedsQuotaLimit(_issuer, afterDebtBalance, 0, 0, true);
    }

 function burnPynths(address _from, bytes32 _currencyKey, uint _burnAmount) external onlyPeriFinance {
             _requireCurrencyKeyIsNotpUSD(_currencyKey);

        if (_currencyKey != PERI && _currencyKey != bytes32(0)) {
            // unstake ex-tokens.
            _unstakeExTokens(_from, _burnAmount, _currencyKey, false);
            return;
        }


        (uint debtBalance, uint systemDebt, bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(_from), pUSD);
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


    // SIP-148: Upgraded Liquidation Mechanism
    /// @notice This is where the core internal liquidation logic resides. This function can only be invoked by PeriFinance.
    /// Reverts if liquidator().isLiquidationOpen() returns false (e.g. c-ratio is too high, delay hasn't passed,
    ///     account wasn't flagged etc)
    /// @param account The account to be liquidated
    /// @param isSelfLiquidation boolean to determine if this is a forced or self-invoked liquidation
    /// @return totalRedeemed the total amount of collateral (PERI) to redeem (liquid and escrow)
    /// @return debtRemoved the amount of debt (pUSD) to burn in order to fix the account's c-ratio
    /// @return escrowToLiquidate the amount of escrow PERI that will be revoked during liquidation
    function liquidateAccount(address account, bool isSelfLiquidation)
        external
        onlyPeriFinance
        returns (
            uint totalRedeemed,
            uint debtRemoved,
            uint escrowToLiquidate
        )
    {
        //require(liquidator().isLiquidationOpen(account, isSelfLiquidation), "Not open for liquidation");

        // liquidationAmounts checks isLiquidationOpen for the account
        uint initialDebtBalance;
        (totalRedeemed, debtRemoved, escrowToLiquidate, initialDebtBalance) = _liquidationAmounts(
            account,
            isSelfLiquidation
        );

        (, uint totalDebt ,) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(account), PERI);
        // Reduce debt shares by amount to liquidate.
        _removeFromDebtRegister(account, debtRemoved, initialDebtBalance, totalDebt);

        if (!isSelfLiquidation) {
            // In case of forced liquidation only, remove the liquidation flag.
            //liquidator().removeAccountInLiquidation(account);
        }
        // Note: To remove the flag after self liquidation, burn to target and then call Liquidator.checkAndRemoveAccountInLiquidation(account).
    }

    function _liquidationAmounts(address account, bool isSelfLiquidation)
        internal
        view
        returns (
            uint totalRedeemed,
            uint debtToRemove,
            uint escrowToLiquidate,
            uint debtBalance
        )
    {
        // Get the account's debt balance
        bool anyRateIsInvalid;
        (debtBalance, , anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(account), pUSD);

        // Get the PERI rate
        (uint periRate, bool periRateInvalid) = _rateAndInvalid(PERI);
        _requireRatesNotInvalid(anyRateIsInvalid || periRateInvalid);

        uint penalty;
        if (isSelfLiquidation) {
            // Get self liquidation penalty
            penalty = getSelfLiquidationPenalty();

  
            // Get the minimum values for both totalRedeemed and debtToRemove
            totalRedeemed = _getMinValue(
                _usdToSnx(debtToRemove, periRate).multiplyDecimal(SafeDecimalMath.unit().add(penalty)),
                _periBalanceOf(account)
            );
            debtToRemove = _getMinValue(
                _periToUSD(totalRedeemed, periRate).divideDecimal(SafeDecimalMath.unit().add(penalty)),
                debtToRemove
            );

            // Return escrow as zero since it cannot be self liquidated
            return (totalRedeemed, debtToRemove, 0, debtBalance);
        } else {
            // In the case of forced Liquidation
            // Get the forced liquidation penalty and sum of the flag and liquidate rewards.
            //penalty = getSnxLiquidationPenalty();
            uint rewardsSum = getLiquidateReward().add(getFlagReward());

            // Get the total USD value of their PERI collateral (including escrow and rewards minus the flag and liquidate rewards)
            //uint collateralForAccountUSD = _periToUSD(_collateral(account).sub(rewardsSum), periRate);

            // Calculate the amount of debt to remove and the pUSD value of the PERI required to liquidate.
            //debtToRemove = liquidator().calculateAmountToFixCollateral(debtBalance, collateralForAccountUSD, penalty);
            uint redeemTarget = _usdToSnx(debtToRemove, periRate).multiplyDecimal(SafeDecimalMath.unit().add(penalty));

            if (redeemTarget.add(rewardsSum) >= _collateral(account)) {
                // need to wipe out the account
                debtToRemove = debtBalance;
                totalRedeemed = _collateral(account).sub(rewardsSum);
                escrowToLiquidate = _rewardEscrowBalanceOf(account);
                return (totalRedeemed, debtToRemove, escrowToLiquidate, debtBalance);
            } else {
                // normal forced liquidation
                (totalRedeemed, escrowToLiquidate) = _redeemableCollateralForTarget(account, redeemTarget, rewardsSum);
                return (totalRedeemed, debtToRemove, escrowToLiquidate, debtBalance);
            }
        }
    }

    // SIP-252
    // calculates the amount of PERI that can be force liquidated (redeemed)
    // for the various cases of transferrable & escrowed collateral
    function _redeemableCollateralForTarget(
        address account,
        uint redeemTarget,
        uint rewardsSum
    ) internal view returns (uint totalRedeemed, uint escrowToLiquidate) {
        // The balanceOf here can be considered "transferable" since it's not escrowed,
        // and it is the only PERI that can potentially be transfered if unstaked.
        uint transferable = _periBalanceOf(account);
        if (redeemTarget.add(rewardsSum) <= transferable) {
            // transferable is enough
            return (redeemTarget, 0);
        } else {
            // if transferable is not enough
            // need only part of the escrow, add the needed part to redeemed
            escrowToLiquidate = redeemTarget.add(rewardsSum).sub(transferable);
            return (redeemTarget, escrowToLiquidate);
        }
    }

    function _getMinValue(uint x, uint y) internal pure returns (uint) {
        return x < y ? x : y;
    }

    function setCurrentPeriodId(uint128 periodId) external {
        require(msg.sender == requireAndGetAddress(CONTRACT_FEEPOOL), "Must be fee pool");

        IPeriFinanceDebtShare sds = periFinanceDebtShare();

        if (sds.currentPeriodId() < periodId) {
            sds.takeSnapshot(periodId);
        }
    }


    function liquidateDelinquentAccount(
        address account,
        uint pusdAmount,
        address liquidator
    ) external onlyPeriFinance returns (uint totalRedeemed, uint amountToLiquidate) {
        // Ensure waitingPeriod and pUSD balance is settled as burning impacts the size of debt pool
        require(!exchanger().hasWaitingPeriodOrSettlementOwing(liquidator, pUSD), "pUSD needs to be settled");

        // Check account is liquidation open
        require(liquidations().isOpenForLiquidation(account), "Account not open for liquidation"); //  --> moved to liquidations().liquidateAccount()

        // require liquidator has enough pUSD
        require(IERC20(address(pynths[pUSD])).balanceOf(liquidator) >= pusdAmount, "Not enough pUSD");

        // What is their debt in pUSD?
        (uint debtBalance, uint totalDebtIssued, bool anyRateIsInvalid) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(account), pUSD);
        // (uint periRate, bool periRateInvalid) = exchangeRates().rateAndInvalid(PERI);
        _requireRatesNotInvalid(
            anyRateIsInvalid /*  || periRateInvalid */
        );

      
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
        (debtBalance, , rateIsInvalid) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(_account), pUSD);

        (exSR, maxSR) = exTokenManager().exStakingRatio(_account, debtBalance);
    }

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
        (existDebt, , ) = _debtBalanceOfAndTotalDebt(_debtShareBalanceOf(_issuer), pUSD);
        (maxIssuable, tRatio) = _maxIssuablePynths(_issuer, existDebt);
    }

    function _issuePynths(
        address from,
        uint amount,
        uint existingDebt
    ) internal returns (uint afterDebt) {

        // (uint maxIssuable, , ) = _remainingIssuablePynths(from);

        // if (!issueMax) {
        //     require(amount <= maxIssuable, "Amount too large");
        // } else {
        //     amount = maxIssuable;
        // }
      


        // // Keep track of the debt they're about to create
        // (uint existingDebt, uint totalSystemDebt , ) = _debtBalanceOfAndTotalDebt(from, pUSD);

        if (_verifyCircuitBreakers()) {
            return existingDebt;
        }

          if (amount == 0) {
            return existingDebt;
        }

        _addToDebtRegister(from, amount);

        // record issue timestamp
        _setLastIssueEvent(from);

        // Create their pynths
        pynths[pUSD].issue(from, amount);

        // Account for the issued debt in the cache
        debtCache().updateCachedpUSDDebt(SafeCast.toInt256(amount));

 
        afterDebt = existingDebt.add(amount);

    }

    function _burnPynths(
        address debtAccount,
        address burnAccount,
        uint amountBurnt,
        uint existingDebt,
        uint totalDebtIssued
    ) internal returns (uint) {
        // if (_verifyCircuitBreakers()) {
        //     return 0;
        // }

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
        //_appendAccountIssuanceRecord(debtAccount);

        return amountBurnt;

    }


    // If burning to target, `amount` is ignored, and the correct quantity of pUSD is burnt to reach the target
    // c-ratio, allowing fees to be claimed. In this case, pending settlements will be skipped as the user
    // will still have debt remaining after reaching their target.
 function _voluntaryBurnPynths(
        address from,
        uint amount,
        uint existingDebt,
        uint totalSystemValue,
        bool burnToTarget
    ) internal
        returns (uint tRatio) 
    {
        if (_verifyCircuitBreakers()) {
            return 0;
        }

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

        // Check and remove liquidation if existingDebt after burning is <= maxIssuableSynths
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

    function _addToDebtRegister(
        address from,
        uint amount
    ) internal {
   
        // doing nothing just left for version compatibility
        crossChainManager().addCurrentNetworkIssuedDebt(amount);

        

        IPeriFinanceDebtShare sds = periFinanceDebtShare();

        // it is possible (eg in tests, system initialized with extra debt) to have issued debt without any shares issued
        // in which case, the first account to mint gets the debt. yw.
        uint debtShares = _sharesForDebt(amount);
        if (debtShares == 0) {
            sds.mintShare(from, amount);
        } else {
            sds.mintShare(from, debtShares);
        }
    }


    function _removeFromDebtRegister(
        address from,
        uint debtToRemove,
        uint existingDebt,
        uint totalDebtIssued
    ) internal {
   
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


        IPeriFinanceDebtShare sds = periFinanceDebtShare();

        uint currentDebtShare = periFinanceDebtShare().balanceOf(from);

        // Are they exiting the system, or are they just decreasing their debt position?
        if (debtToRemove == existingDebt) {
            
            sds.burnShare(from, currentDebtShare);
            // doing nothing just left for version compatibility
            // crossChainManager().clearCrossNetworkUserDebt(from);
        } else {
            // What percentage of the debt will they be left with?
         
            uint sharesToRemove = _sharesForDebt(debtToRemove);
            sds.burnShare(from, sharesToRemove < currentDebtShare ? sharesToRemove : currentDebtShare);

            // doing nothing just left for version compatibility
            // crossChainManager().setCrossNetworkUserDebt(from, state.debtLedgerLength());
        }

        // update current network issued debt
        crossChainManager().subtractCurrentNetworkIssuedDebt(debtToRemove);
    }

    // trips the breaker and returns boolean, where true means the breaker has tripped state
    function _verifyCircuitBreakers() internal returns (bool) {
        address debtRatioAggregator = requireAndGetAddress(CONTRACT_EXT_AGGREGATOR_DEBT_RATIO);
        (, int256 rawRatio, , , ) = AggregatorV2V3Interface(debtRatioAggregator).latestRoundData();
        (, bool broken, ) = exchangeRates().rateWithSafetyChecks(PERI);

        return circuitBreaker().probeCircuitBreaker(debtRatioAggregator, uint(rawRatio)) || broken;
    }

    function _requireCurrencyKeyIsNotpUSD(bytes32 _currencyKey) internal pure {
        require(_currencyKey != pUSD, "pUSD isn't stakable");
    }

    function _requireExistingDebt(uint existingDebt) internal pure {
        require(existingDebt > 0, "User has no debt");
    }


    /* ========== MODIFIERS ========== */
    modifier onlyPeriFinance() {
        require(msg.sender == address(periFinanceERC20()), "Only PeriFinance");
        _;
    }

    modifier onlyTrustedMinters() {
        address bridgeL1 = resolver.getAddress(CONTRACT_PERIFINANCEBRIDGETOOPTIMISM);
        // address bridgeL2 = resolver.getAddress(CONTRACT_PERIFINANCEBRIDGETOBASE);
        address feePool = resolver.getAddress(CONTRACT_FEEPOOL);
        //require(msg.sender == bridgeL1 || msg.sender == bridgeL2 || msg.sender == feePool, "only trusted minters");
        require(msg.sender == bridgeL1 || msg.sender == feePool , "only trusted minters");
        _;
    }

    /* ========== EVENTS ========== */

    event PynthAdded(bytes32 currencyKey, address pynth);
    event PynthRemoved(bytes32 currencyKey, address pynth);
}
