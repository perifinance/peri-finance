pragma solidity 0.5.16;

import "./IPynth.sol";
import "./IVirtualPynth.sol";

// https://docs.peri.finance/contracts/source/interfaces/iperiFinance
interface IPeriFinance {
    // Views
    function getRequiredAddress(bytes32 contractName) external view returns (address);

    function anyPynthOrPERIRateIsInvalid() external view returns (bool anyRateInvalid);

    function availableCurrencyKeys() external view returns (bytes32[] memory);

    function availablePynthCount() external view returns (uint);

    function availablePynths(uint index) external view returns (IPynth);

    function collateral(address account) external view returns (uint);

    function collateralisationRatio(address issuer) external view returns (uint);

    function debtBalanceOf(address issuer, bytes32 currencyKey) external view returns (uint);

    function isWaitingPeriod(bytes32 currencyKey) external view returns (bool);

    function maxIssuablePynths(address issuer) external view returns (uint maxIssuable);

    function externalTokenQuota(
        address _account,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) external view returns (uint);

    function remainingIssuablePynths(address issuer)
        external
        view
        returns (
            uint maxIssuable,
            uint alreadyIssued,
            uint totalSystemDebt
        );

    function maxExternalTokenStakeAmount(address _account, bytes32 _currencyKey)
        external
        view
        returns (uint issueAmountToQuota, uint stakeAmountToQuota);

    function pynths(bytes32 currencyKey) external view returns (IPynth);

    function pynthsByAddress(address pynthAddress) external view returns (bytes32);

    function totalIssuedPynths(bytes32 currencyKey) external view returns (uint);

    function totalIssuedPynthsExcludeEtherCollateral(bytes32 currencyKey) external view returns (uint);

    function transferablePeriFinance(address account) external view returns (uint transferable);

    // Mutative Functions
    function issuePynths(bytes32 _currencyKey, uint _issueAmount) external;

    function issueMaxPynths() external;

    function issuePynthsToMaxQuota(bytes32 _currencyKey) external;

    function burnPynths(bytes32 _currencyKey, uint _burnAmount) external;

    function fitToClaimable() external;

    function exit() external;

    function exchange(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey
    ) external returns (uint amountReceived);

    function exchangeOnBehalf(
        address exchangeForAddress,
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey
    ) external returns (uint amountReceived);

    function exchangeWithTracking(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address originator,
        bytes32 trackingCode
    ) external returns (uint amountReceived);

    function exchangeOnBehalfWithTracking(
        address exchangeForAddress,
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address originator,
        bytes32 trackingCode
    ) external returns (uint amountReceived);

    function exchangeWithVirtual(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        bytes32 trackingCode
    ) external returns (uint amountReceived, IVirtualPynth vPynth);

    function mint(address _user, uint _amount) external returns (bool);

    function inflationalMint(uint _networkDebtShare) external returns (bool);

    function settle(bytes32 currencyKey)
        external
        returns (
            uint reclaimed,
            uint refunded,
            uint numEntries
        );

    // Liquidations
    function liquidateDelinquentAccount(address account, uint pusdAmount) external returns (bool);

    // Restricted Functions

    function mintSecondary(address account, uint amount) external;

    function mintSecondaryRewards(uint amount) external;

    function burnSecondary(address account, uint amount) external;
}
