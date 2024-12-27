pragma solidity 0.5.16;

import "./IPynth.sol";
import "./IVirtualPynth.sol";

// https://docs.peri.finance/contracts/source/interfaces/iperiFinance
interface IPeriFinance {
    // Views
    //function getRequiredAddress(bytes32 contractName) external view returns (address);

    // function collateral(address account) external view returns (uint);

    function collateralisationRatio(address issuer) external view returns (uint);

    function debtBalanceOf(address issuer, bytes32 currencyKey) external view returns (uint);

    function isWaitingPeriod(bytes32 currencyKey) external view returns (bool);

    function maxIssuablePynths(address issuer) external view returns (uint maxIssuable);

    function remainingIssuablePynths(address issuer)
        external
        view
        returns (
            uint maxIssuable,
            uint alreadyIssued,
            uint totalSystemDebt
        );

    //function pynths(bytes32 currencyKey) external view returns (IPynth);

    function totalIssuedPynths(bytes32 currencyKey) external view returns (uint);

    function totalIssuedPynthsExcludeOtherCollateral(bytes32 currencyKey) external view returns (uint);

    function transferablePeriFinance(address account) external view returns (uint transferable);

    //function amountsToFitClaimable(address account) external view returns (uint burnAmount, uint exTokenAmountToUnstake);

    // Mutative Functions
    function issuePynths(bytes32 _currencyKey, uint _issueAmount) external;

    function issueMaxPynths() external;

    function issuePynthsToMaxQuota(bytes32 _currencyKey) external;

    function burnPynths(bytes32 _currencyKey, uint _burnAmount) external;


    function fitToClaimable() external payable;

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

    function exchangeWithTrackingForInitiator(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address rewardAddress,
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

    function inflationalMint() external returns (bool);

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

    // function migrateAccountBalances(address account) external returns (uint totalEscrowRevoked, uint totalLiquidBalance);
}
