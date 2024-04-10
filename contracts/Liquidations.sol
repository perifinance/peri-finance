pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/ILiquidations.sol";

// Libraries
import "./SafeDecimalMath.sol";

// Internal references
import "./EternalStorage.sol";
import "./interfaces/IPeriFinance.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/ISystemStatus.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IExternalTokenStakeManager.sol";

// https://docs.peri.finance/contracts/source/contracts/liquidations
contract Liquidations is Owned, MixinSystemSettings, ILiquidations {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    struct LiquidationEntry {
        uint deadline;
        address caller;
    }
    bytes32 internal constant pUSD = "pUSD";
    bytes32 internal constant PERI = "PERI";
    bytes32 internal constant PERI_ONLY = "P";
    bytes32 internal constant COMPOUND = "C";
    bytes32 internal constant INSTITUTION = "I";

    uint internal constant MAX_CP_ISSUANCE_RATIO = 5e17; // 0.5 issuance ratio

    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_SYSTEMSTATUS = "SystemStatus";
    bytes32 private constant CONTRACT_PERIFINANCE = "PeriFinance";
    bytes32 private constant CONTRACT_ETERNALSTORAGE_LIQUIDATIONS = "EternalStorageLiquidations";
    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";
    bytes32 private constant CONTRACT_EXTOKENSTAKEMANAGER = "ExternalTokenStakeManager";

    /* ========== CONSTANTS ========== */

    // Storage keys
    bytes32 public constant LIQUIDATION_DEADLINE = "LiquidationDeadline";
    bytes32 public constant LIQUIDATION_CALLER = "LiquidationCaller";

    constructor(address _owner, address _resolver) public Owned(_owner) MixinSystemSettings(_resolver) {}

    /* ========== VIEWS ========== */
    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](6);
        newAddresses[0] = CONTRACT_SYSTEMSTATUS;
        newAddresses[1] = CONTRACT_PERIFINANCE;
        newAddresses[2] = CONTRACT_ETERNALSTORAGE_LIQUIDATIONS;
        newAddresses[3] = CONTRACT_ISSUER;
        newAddresses[4] = CONTRACT_EXRATES;
        newAddresses[5] = CONTRACT_EXTOKENSTAKEMANAGER;
        addresses = combineArrays(existingAddresses, newAddresses);
    }

    function periFinance() internal view returns (IPeriFinance) {
        return IPeriFinance(requireAndGetAddress(CONTRACT_PERIFINANCE));
    }

    function systemStatus() internal view returns (ISystemStatus) {
        return ISystemStatus(requireAndGetAddress(CONTRACT_SYSTEMSTATUS));
    }

    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXRATES));
    }

    // refactor to periFinance storage eternal storage contract once that's ready
    function eternalStorageLiquidations() internal view returns (EternalStorage) {
        return EternalStorage(requireAndGetAddress(CONTRACT_ETERNALSTORAGE_LIQUIDATIONS));
    }

    function exTokenStakeManager() internal view returns (IExternalTokenStakeManager) {
        return IExternalTokenStakeManager(requireAndGetAddress(CONTRACT_EXTOKENSTAKEMANAGER));
    }

    function liquidationDelay() external view returns (uint) {
        return getLiquidationDelay();
    }

    function liquidationRatio(address account) external view returns (uint) {
        return _liquidationRatio(account);
    }

    function _liquidationRatio(address account) internal view returns (uint ratio) {
        ratio = issuer().getTargetRatio(account);

        bytes32 userType =
            ratio <= MAX_CP_ISSUANCE_RATIO
                ? ratio == getIssuanceRatio()
                    ? PERI_ONLY // 25e16           // 150% collateral ratio
                    : COMPOUND // 8e17            // 125% collateral ratio
                : INSTITUTION; // 8.333333e17            // 125% collateral ratio

        ratio = getLiquidationRatios(userType);
    }

    function liquidationPenalty() external view returns (uint) {
        return getLiquidationPenalty();
    }

    function liquidationCollateralRatio(address account) external view returns (uint) {
        return SafeDecimalMath.unit().divideDecimalRound(_liquidationRatio(account));
    }

    function getLiquidationDeadlineForAccount(address account) external view returns (uint) {
        LiquidationEntry memory liquidation = _getLiquidationEntryForAccount(account);
        return liquidation.deadline;
    }

    function isOpenForLiquidation(address account) external view returns (bool isOpen) {
        // get target ratio and c-ratio
        (uint tRatio, uint cRatio, , , , ) = issuer().getRatios(account, true);
        // uint lRatio = _liquidationRatio(account);
        // Liquidation closed if collateral ratio less than or equal target issuance Ratio
        // Account with no peri collateral will also not be open for liquidation (ratio is 0)
        isOpen = (tRatio < cRatio && _isOpenForLiquidation(account));
    }

    function isLiquidationDeadlinePassed(address account) external view returns (bool isPassed) {
        // LiquidationEntry memory liquidation = _getLiquidationEntryForAccount(account);
        // return _deadlinePassed(liquidation.deadline);
        isPassed = _isOpenForLiquidation(account);
    }

    function getLiquidationInfo(address account) external view returns (uint deadline, bool isOpen) {
        LiquidationEntry memory liquidation = _getLiquidationEntryForAccount(account);
        deadline = liquidation.deadline;
        isOpen = _deadlinePassed(liquidation.deadline);
    }

    function calcAmtToFixCollateral(
        uint debtBalance,
        uint collateral,
        uint tRatio
    ) external view returns (uint amountToFixRatio) {
        amountToFixRatio = _calcAmtToFixCollateral(debtBalance, collateral, tRatio);
    }

    function _deadlinePassed(uint deadline) internal view returns (bool isPassed) {
        // check deadline is set > 0
        // check now > deadline
        isPassed = deadline > 0 && now > deadline;
    }

    function _getKey(bytes32 _scope, address _account) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_scope, _account));
    }

    function _preciseMul(uint x, uint y) internal pure returns (uint) {
        return (y == 0 || x == 0) ? 0 : x.decimalToPreciseDecimal().multiplyDecimalRoundPrecise(y.decimalToPreciseDecimal());
    }

    function _preciseDiv(uint x, uint y) internal pure returns (uint) {
        return (y == 0 || x == 0) ? 0 : x.decimalToPreciseDecimal().divideDecimalRoundPrecise(y.decimalToPreciseDecimal());
    }

    function _preciseMulToDecimal(uint x, uint y) internal pure returns (uint) {
        return (y == 0 || x == 0) ? 0 : _preciseMul(x, y).preciseDecimalToDecimal();
    }

    function _preciseDivToDecimal(uint x, uint y) internal pure returns (uint) {
        return (y == 0 || x == 0) ? 0 : _preciseDiv(x, y).preciseDecimalToDecimal();
    }

    /**
     * r = target issuance ratio
     * D = debt balance
     * V = Collateral
     * P = liquidation penalty
     * Calculates amount of pynths = (D - V * r) / (1 - (1 + P) * r)
     */
    function _calcAmtToFixCollateral(
        /* address account, */
        uint debtBalance,
        uint collateral,
        uint tRatio
    ) internal view returns (uint) {
        // uint tRatio = issuer().getTargetRatio(account); // getIssuanceRatio();
        uint unit = SafeDecimalMath.unit();

        return
            (debtBalance.sub(_preciseMulToDecimal(collateral, tRatio))).divideDecimal(
                unit.sub(_preciseMulToDecimal(unit.add(getLiquidationPenalty()), tRatio))
            );

        // return dividend.divideDecimal(divisor);
    }

    // get liquidationEntry for account
    // returns deadline = 0 when not set
    function _getLiquidationEntryForAccount(address account) internal view returns (LiquidationEntry memory _liquidation) {
        _liquidation.deadline = eternalStorageLiquidations().getUIntValue(_getKey(LIQUIDATION_DEADLINE, account));

        // liquidation caller not used
        _liquidation.caller = address(0);
    }

    function _isOpenForLiquidation(address account)
        internal
        view
        returns (
            bool isOpen /* , uint tRatio, uint exDebt, uint exEA */
        )
    {
        LiquidationEntry memory liquidation = _getLiquidationEntryForAccount(account);

        // liquidation cap at issuanceRatio is checked above
        return _deadlinePassed(liquidation.deadline);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    // totalIssuedPynths checks pynths for staleness
    // check peri rate is not stale
    function flagAccountForLiquidation(address account) external rateNotInvalid("PERI") {
        systemStatus().requireSystemActive();

        require(_liquidationRatio(account) > 0, "Liquidation ratio not set");
        require(getLiquidationDelay() > 0, "Liquidation delay not set");

        LiquidationEntry memory liquidation = _getLiquidationEntryForAccount(account);
        require(liquidation.deadline == 0, "Account already flagged for liquidation");

        uint accountsCollateralisationRatio = issuer().collateralisationRatio(account);

        // if accounts issuance ratio is greater than or equal to liquidation ratio set liquidation entry
        require(
            accountsCollateralisationRatio >= _liquidationRatio(account),
            "Account issuance ratio is less than liquidation ratio"
        );

        uint deadline = now.add(getLiquidationDelay());

        _storeLiquidationEntry(account, deadline, msg.sender);

        emit AccountFlaggedForLiquidation(account, deadline);
    }

    // Public function to allow an account to remove from liquidations
    // Checks collateral ratio is fixed - below target issuance ratio
    // Check PERI rate is not stale
    function checkAndRemoveAccountInLiquidation(address account) external rateNotInvalid("PERI") {
        systemStatus().requireSystemActive();

        LiquidationEntry memory liquidation = _getLiquidationEntryForAccount(account);

        require(liquidation.deadline > 0, "Account has no liquidation set");

        // get target ratio and c-ratio
        uint tRatio;
        uint cRatio;
        (tRatio, cRatio, , , , ) = issuer().getRatios(account, true);

        // Remove from liquidations if accountsCollateralisationRatio is fixed (less than equal target issuance ratio)
        if (tRatio >= cRatio) {
            _removeLiquidationEntry(account);
        }
    }

    function maxLiquidateAmt(
        address account,
        uint pusdAmount,
        uint debtBalance
    )
        external
        view
        returns (
            uint totalRedeemed,
            uint amountToLiquidate,
            uint exRedeem,
            uint idealExSA
        )
    {
        bool periRateInvalid;
        (exRedeem, periRateInvalid) = exchangeRates().rateAndInvalid(PERI);
        require(!periRateInvalid, "PERI rate is invalid");

        // get PERI collateral
        uint colinUSD = _preciseMulToDecimal(IERC20(address(periFinance())).balanceOf(account), exRedeem);

        // get target ratio and c-ratio
        uint tRatio;
        uint exEA;
        uint exTSR;
        (tRatio, idealExSA, exTSR, exEA) = _idealExAmount(account, debtBalance, colinUSD);

        // calculate removable exEA in order to fix collateral ratio
        (idealExSA, periRateInvalid) = exEA > idealExSA ? (exEA.sub(idealExSA), true) : (0, false);

        // get total estimated staked amount in USD
        colinUSD = colinUSD.add(exEA);

        // get needed pUSD amount to fix ratio and save it to exEA
        exEA = _calcAmtToFixCollateral(debtBalance, colinUSD, tRatio);

        // Cap amount to liquidate to repair collateral ratio based on issuance ratio
        amountToLiquidate = exEA < pusdAmount ? exEA : pusdAmount;

        // Add penalty to the amount to get liquidated
        totalRedeemed = _preciseMulToDecimal(amountToLiquidate, SafeDecimalMath.unit().add(getLiquidationPenalty()));

        // Cap liquidate amount again and subtract penalty from it
        if (totalRedeemed > colinUSD) {
            totalRedeemed = colinUSD;

            amountToLiquidate = _preciseDivToDecimal(colinUSD, SafeDecimalMath.unit().add(getLiquidationPenalty()));
        }

        // if exEA is greater than
        exRedeem = periRateInvalid
            ? totalRedeemed > idealExSA // ? idealExSA.add(_preciseMulToDecimal(totalRedeemed.sub(idealExSA), exTSR))
                ? idealExSA
                : totalRedeemed // : totalRedeemed.multiplyDecimal(exTSR);
            : _preciseMulToDecimal(totalRedeemed, exTSR);

        // amountToLiquidate = totalRedeemed.sub(idealExSA);
        // idealExSA = exEA;
    }

    function _idealExAmount(
        address _account,
        uint _existDebt,
        uint _periCol
    )
        internal
        view
        returns (
            uint tRatio,
            uint idealExSA,
            uint exSR,
            uint exEA
        )
    {
        uint exTR;
        (tRatio, idealExSA, exTR, exEA, exSR, ) = exTokenStakeManager().getRatios(_account, _existDebt, _periCol);
        // Liquidation closed if collateral ratio less than or equal target issuance Ratio
        // Account with no peri collateral will also not be open for liquidation (ratio is 0)
        require(tRatio < idealExSA && _isOpenForLiquidation(_account), "Account not open for liquidation");

        // uint periIR = getIssuanceRatio();
        // // Se-max = (Tmax - Tp) / (Te - Tp)
        // exTSR = _preciseDivToDecimal(getExternalTokenQuota().sub(periIR), exTSR.sub(periIR));

        exTR = _preciseMulToDecimal(exEA, exTR);
        // derived peri Staked Amount from _existDebt and save it to periSA
        uint periSA = _existDebt > exTR ? _existDebt.sub(exTR) : 0;

        // calc peri Staked Amount out of peri staked amount and peri issuance ratio
        periSA = _preciseDivToDecimal(periSA, getIssuanceRatio());

        idealExSA = _periCol < periSA ? _periCol.add(exEA) : periSA.add(exEA);
        exSR = exEA.divideDecimal(idealExSA);
        idealExSA = exEA;

        // uint exSR = exEA.add(periCol);
        // exSR = exEA.divideDecimal(idealExSA);
        // exSR = exSR > maxSR ? maxSR : exSR;
        // idealExSA = _preciseDivToDecimal(_existDebt, tRatio);
        // idealExSA = _preciseMulToDecimal(idealExSA, exSR);

        // calc EX-token Staking Amount with peri's collateral and exSR
        // idealExSA = periCol.multiplyDecimal(exSR).divideDecimal(SafeDecimalMath.unit().sub(exSR));
        // idealExSA = idealExSA.roundDownDecimal(uint(18).sub(minDecimals));
    }

    function liquidateAccount(
        address account,
        address liquidator,
        uint pusdAmount,
        uint debtBalance
    ) external onlyIssuer returns (uint totalRedeemed, uint amountToLiquidate) {
        systemStatus().requireSystemActive();
        require(pusdAmount > 0, "Liquidation amount can not be 0");
        (uint periRate, bool periRateInvalid) = exchangeRates().rateAndInvalid(PERI);
        require(!periRateInvalid, "PERI rate is invalid");

        // get PERI collateral
        uint colinUSD = _preciseMulToDecimal(IERC20(address(periFinance())).balanceOf(account), periRate);

        // get target ratio and c-ratio
        uint tRatio;
        uint idealExSA;
        uint exEA;
        uint exTSR;
        (tRatio, idealExSA, exTSR, exEA) = _idealExAmount(account, debtBalance, colinUSD);

        // calculate removable exEA in order to fix collateral ratio
        // (idealExSA, periRateInvalid) = exEA > idealExSA ? (exEA.sub(idealExSA), true) : (0, false);

        // get total estimated staked amount in USD
        colinUSD = colinUSD.add(exEA);

        // get needed pUSD amount to fix ratio and save it to exEA
        exEA = _calcAmtToFixCollateral(debtBalance, colinUSD, tRatio);

        // Cap amount to liquidate to repair collateral ratio based on issuance ratio
        amountToLiquidate = exEA < pusdAmount ? exEA : pusdAmount;

        // Add penalty to the amount to get liquidated
        totalRedeemed = _preciseMulToDecimal(amountToLiquidate, SafeDecimalMath.unit().add(getLiquidationPenalty()));

        // Cap liquidate amount again and subtract penalty from it
        if (totalRedeemed > colinUSD) {
            totalRedeemed = colinUSD;

            amountToLiquidate = _preciseDivToDecimal(colinUSD, SafeDecimalMath.unit().add(getLiquidationPenalty()));
        }

        // get exToken redeem amount
        idealExSA = _preciseMulToDecimal(totalRedeemed, exTSR);

        // move exTokens to the liquidator and save the remain amount to tRatio
        exTSR = idealExSA > 0 ? exTokenStakeManager().redeem(account, idealExSA, liquidator) : 0;

        // calc liquiating amount of PERI total : redeeming amount - external token liquidating amount + remaining amount from external token liquidation.
        totalRedeemed = totalRedeemed.add(exTSR).sub(idealExSA);

        // what's the equivalent amount of peri for the liquidating amount for PERI?
        totalRedeemed = _preciseDivToDecimal(totalRedeemed, periRate);

        // calc cRatio after liquidation and save it to exEA
        exEA = debtBalance.sub(amountToLiquidate).divideDecimal(colinUSD.sub(amountToLiquidate));

        // Remove liquidation flag if amount liquidated fixes ratio
        if (tRatio > exEA || exEA.sub(tRatio) < 1e12) {
            // Remove liquidation
            _removeAccountInLiquidation(account);
        }
    }

    // Internal function to remove account from liquidations
    // Does not check collateral ratio is fixed
    function removeAccountInLiquidation(address account) external onlyIssuer {
        _removeAccountInLiquidation(account);
    }

    function _removeAccountInLiquidation(address account) internal {
        LiquidationEntry memory liquidation = _getLiquidationEntryForAccount(account);
        if (liquidation.deadline > 0) {
            _removeLiquidationEntry(account);
        }
    }

    function _removeLiquidationEntry(address _account) internal {
        // delete liquidation deadline
        eternalStorageLiquidations().deleteUIntValue(_getKey(LIQUIDATION_DEADLINE, _account));
        // delete liquidation caller
        eternalStorageLiquidations().deleteAddressValue(_getKey(LIQUIDATION_CALLER, _account));

        emit AccountRemovedFromLiquidation(_account, now);
    }

    function _storeLiquidationEntry(
        address _account,
        uint _deadline,
        address _caller
    ) internal {
        // record liquidation deadline
        eternalStorageLiquidations().setUIntValue(_getKey(LIQUIDATION_DEADLINE, _account), _deadline);
        eternalStorageLiquidations().setAddressValue(_getKey(LIQUIDATION_CALLER, _account), _caller);
    }

    /* ========== MODIFIERS ========== */
    modifier onlyIssuer() {
        require(msg.sender == address(issuer()), "Liquidations: Only the Issuer contract can perform this action");
        _;
    }

    modifier rateNotInvalid(bytes32 currencyKey) {
        require(!exchangeRates().rateIsInvalid(currencyKey), "Rate invalid or not a pynth");
        _;
    }

    /* ========== EVENTS ========== */

    event AccountFlaggedForLiquidation(address indexed account, uint deadline);
    event AccountRemovedFromLiquidation(address indexed account, uint time);
}
