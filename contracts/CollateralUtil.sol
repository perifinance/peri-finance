pragma solidity ^0.5.16;

pragma experimental ABIEncoderV2;

// Inheritance
import "./interfaces/IAddressResolver.sol";
import "./interfaces/ICollateralUtil.sol";
import "./interfaces/ICollateralLoan.sol";
import "./interfaces/IExchangeRates.sol";
import "./MixinSystemSettings.sol";

import "./SafeDecimalMath.sol";

contract CollateralUtil is ICollateralUtil, ICollateralLoan, MixinSystemSettings {
    /* ========== LIBRARIES ========== */
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    /* ========== CONSTANTS ========== */

    bytes32 private constant pUSD = "pUSD";

    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](1);
        newAddresses[0] = CONTRACT_EXRATES;
        addresses = combineArrays(existingAddresses, newAddresses);
    }

    /* ---------- Related Contracts ---------- */

    function _exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(resolver.requireAndGetAddress(CONTRACT_EXRATES, "Missing ExchangeRates contract"));
    }

    constructor(address _resolver) public MixinSystemSettings(_resolver) {}

    /* ========== UTILITY VIEW FUNCS ========== */

    function getCollateralRatio(Loan calldata loan, bytes32 collateralKey) external view returns (uint cratio) {
        uint cvalue = _exchangeRates().effectiveValue(collateralKey, loan.collateral, pUSD);
        uint dvalue = _exchangeRates().effectiveValue(loan.currency, loan.amount.add(loan.accruedInterest), pUSD);
        return cvalue.divideDecimal(dvalue);
    }

    function maxLoan(
        uint amount,
        bytes32 currency,
        uint minCratio,
        bytes32 collateralKey
    ) external view returns (uint max) {
        uint ratio = SafeDecimalMath.unit().divideDecimalRound(minCratio);
        return ratio.multiplyDecimal(_exchangeRates().effectiveValue(collateralKey, amount, currency));
    }

    /**
     * r = target issuance ratio
     * D = debt value in pUSD
     * V = collateral value in pUSD
     * P = liquidation penalty
     * Calculates amount of pynths = (D - V * r) / (1 - (1 + P) * r)
     * Note: if you pass a loan in here that is not eligible for liquidation it will revert.
     * We check the ratio first in liquidateInternal and only pass eligible loans in.
     */
    function liquidationAmount(
        Loan calldata loan,
        uint minCratio,
        bytes32 collateralKey
    ) external view returns (uint amount) {
        uint liquidationPenalty = getLiquidationPenalty();
        uint debtValue = _exchangeRates().effectiveValue(loan.currency, loan.amount.add(loan.accruedInterest), pUSD);
        uint collateralValue = _exchangeRates().effectiveValue(collateralKey, loan.collateral, pUSD);
        uint unit = SafeDecimalMath.unit();

        uint dividend = debtValue.sub(collateralValue.divideDecimal(minCratio));
        uint divisor = unit.sub(unit.add(liquidationPenalty).divideDecimal(minCratio));

        uint pUSDamount = dividend.divideDecimal(divisor);

        return _exchangeRates().effectiveValue(pUSD, pUSDamount, loan.currency);
    }

    function collateralRedeemed(
        bytes32 currency,
        uint amount,
        bytes32 collateralKey
    ) external view returns (uint collateral) {
        uint liquidationPenalty = getLiquidationPenalty();
        collateral = _exchangeRates().effectiveValue(currency, amount, collateralKey);
        return collateral.multiplyDecimal(SafeDecimalMath.unit().add(liquidationPenalty));
    }
}