pragma solidity 0.5.16;

// https://docs.peri.finance/contracts/source/interfaces/isystemsettings
interface ISystemSettings {
    // Views
    function priceDeviationThresholdFactor() external view returns (uint);

    function waitingPeriodSecs() external view returns (uint);

    function issuanceRatio() external view returns (uint);

    function feePeriodDuration() external view returns (uint);

    function targetThreshold() external view returns (uint);

    function liquidationDelay() external view returns (uint);

    function liquidationRatio() external view returns (uint);

    function liquidationPenalty() external view returns (uint);

    function rateStalePeriod() external view returns (uint);

    function exchangeFeeRate(bytes32 currencyKey) external view returns (uint);

    function minimumStakeTime() external view returns (uint);

    function externalTokenQuota() external view returns (uint);

    function bridgeTransferGasCost() external view returns (uint);

    function bridgeClaimGasCost() external view returns (uint);

    function syncStaleThreshold() external view returns (uint);

    function debtSnapshotStaleTime() external view returns (uint);
}
