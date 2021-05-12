pragma solidity >=0.4.24;

import "../interfaces/IPynth.sol";

// https://docs.peri.finance/contracts/source/interfaces/iissuer
interface IIssuer {
    // Views
    function anyPynthOrPERIRateIsInvalid() external view returns (bool anyRateInvalid);

    function availableCurrencyKeys() external view returns (bytes32[] memory);

    function availablePynthCount() external view returns (uint);

    function availablePynths(uint index) external view returns (IPynth);

    function canBurnPynths(address account) external view returns (bool);

    function collateral(address account) external view returns (uint);

    function collateralisationRatio(address issuer) external view returns (uint);

    function collateralisationRatioAndAnyRatesInvalid(address _issuer)
        external
        view
        returns (uint cratio, bool anyRateIsInvalid);

    function debtBalanceOf(address issuer, bytes32 currencyKey) external view returns (uint debtBalance);

    function issuanceRatio() external view returns (uint);

    function lastIssueEvent(address account) external view returns (uint);

    function maxIssuablePynths(address issuer) external view returns (uint maxIssuable);

    function minimumStakeTime() external view returns (uint);

    function remainingIssuablePynths(address issuer)
        external
        view
        returns (
            uint maxIssuable,
            uint alreadyIssued,
            uint totalSystemDebt
        );

    function pynths(bytes32 currencyKey) external view returns (IPynth);

    function getPynths(bytes32[] calldata currencyKeys) external view returns (IPynth[] memory);

    function pynthsByAddress(address pynthAddress) external view returns (bytes32);

    function totalIssuedPynths(bytes32 currencyKey, bool excludeEtherCollateral) external view returns (uint);

    function transferablePeriFinanceAndAnyRateIsInvalid(address account, uint balance)
        external
        view
        returns (uint transferable, bool anyRateIsInvalid);

    // Restricted: used internally to PeriFinance
    function issuePynths(address from, uint amount) external;

    function issuePynthsOnBehalf(
        address issueFor,
        address from,
        uint amount
    ) external;

    function issueMaxPynths(address from) external;

    function issueMaxPynthsOnBehalf(address issueFor, address from) external;
    
    function stakeUSDCAndIssuePynths(
        address _issuer,
        uint _usdcStakeAmount,
        uint _issueAmount
    ) external;

    function stakeMaxUSDCAndIssuePynths(address _issuer, uint _issueAmount)
    external;

    function stakeUSDCAndIssueMaxPynths(address _issuer, uint _usdcStakeAmount)
    external;

    function stakeMaxUSDCAndIssueMaxPynths(address _issuer)
    external;

    function burnPynths(address from, uint amount) external;

    function burnPynthsOnBehalf(
        address burnForAddress,
        address from,
        uint amount
    ) external;

    function burnPynthsToTarget(address from) external;

    function burnPynthsToTargetOnBehalf(address burnForAddress, address from) external;

    function liquidateDelinquentAccount(
        address account,
        uint pusdAmount,
        address liquidator
    ) external returns (uint totalRedeemed, uint amountToLiquidate);
}
