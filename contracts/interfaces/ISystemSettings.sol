pragma solidity 0.5.16;

// https://docs.peri.finance/contracts/source/interfaces/isystemsettings
interface ISystemSettings {
    // Views
    function waitingPeriodSecs() external view returns (uint);
    
    function priceDeviationThresholdFactor() external view returns (uint);

    function issuanceRatio() external view returns (uint);

    function feePeriodDuration() external view returns (uint);

    function targetThreshold() external view returns (uint);

    function liquidationDelay() external view returns (uint);

    function liquidationRatio() external view returns (uint);


    function liquidationPenalty() external view returns (uint);

    //function periLiquidationPenalty() external view returns (uint);

    function selfLiquidationPenalty() external view returns (uint);

    function flagReward() external view returns (uint);

    function liquidateReward() external view returns (uint);

    function rateStalePeriod() external view returns (uint);

    function exchangeFeeRate(bytes32 currencyKey) external view returns (uint);

    function minimumStakeTime() external view returns (uint);

    function externalTokenQuota() external view returns (uint);

    function bridgeTransferGasCost() external view returns (uint);

    function bridgeClaimGasCost() external view returns (uint);

    function syncStaleThreshold() external view returns (uint);

    function debtSnapshotStaleTime() external view returns (uint);

    function aggregatorWarningFlags() external view returns (address);

    function tradingRewardsEnabled() external view returns (bool);


    function interactionDelay(address collateral) external view returns (uint);

    function atomicTwapWindow() external view returns (uint);

    function atomicEquivalentForDexPricing(bytes32 currencyKey) external view returns (address);

    function atomicExchangeFeeRate(bytes32 currencyKey) external view returns (uint);

    function atomicVolatilityConsiderationWindow(bytes32 currencyKey) external view returns (uint);

    function atomicVolatilityUpdateThreshold(bytes32 currencyKey) external view returns (uint);

    function pureChainlinkPriceForAtomicSwapsEnabled(bytes32 currencyKey) external view returns (bool);
}
