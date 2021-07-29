pragma solidity 0.5.16;

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

    function externalTokenLimit() external view returns (uint);

    function lastIssueEvent(address account) external view returns (uint);

    function maxIssuablePynths(address issuer) external view returns (uint maxIssuable);

    function externalTokenQuota(
        address _account,
        uint _addtionalpUSD,
        uint _addtionalExToken,
        bool _isIssue
    ) external view returns (uint);

    function maxExternalTokenStakeAmount(address _account, bytes32 _currencyKey)
        external
        view
        returns (uint issueAmountToQuota, uint stakeAmountToQuota);

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
    function issuePynths(
        address _issuer,
        bytes32 _currencyKey,
        uint _issueAmount
    ) external;

    function issueMaxPynths(address _issuer) external;

    function issuePynthsToMaxQuota(address _issuer, bytes32 _currencyKey) external;

    function burnPynths(
        address _from,
        bytes32 _currencyKey,
        uint _burnAmount
    ) external;

    function fitToClaimable(address _from) external;

    function exit(address _from) external;

    function liquidateDelinquentAccount(
        address account,
        uint pusdAmount,
        address liquidator
    ) external returns (uint totalRedeemed, uint amountToLiquidate);
}
