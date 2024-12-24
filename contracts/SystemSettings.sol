pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/ISystemSettings.sol";
// Libraries
import "./SystemSettingsLib.sol";


// https://docs.periFinance.io/contracts/source/contracts/systemsettings
contract SystemSettings is Owned, MixinSystemSettings, ISystemSettings {
    // SystemSettingsLib is a way to split out the setters to reduce contract size
    using SystemSettingsLib for IFlexibleStorage;

    constructor(address _owner, address _resolver) public Owned(_owner) MixinSystemSettings(_resolver) {
        // SETTING_CONTRACT_NAME is defined for the getters in MixinSystemSettings and
        // SystemSettingsLib.contractName() is a view into SystemSettingsLib of the contract name
        // that's used by the setters. They have to be equal.
        require(SETTING_CONTRACT_NAME == SystemSettingsLib.contractName(), "read and write keys not equal");
}

    // ========== VIEWS ==========

    // backwards compatibility to having CONTRACT_NAME public constant
    // solhint-disable-next-line func-name-mixedcase
    function CONTRACT_NAME() external view returns (bytes32) {
        return SystemSettingsLib.contractName();
    }

    // SIP-37 Fee Reclamation
    // The number of seconds after an exchange is executed that must be waited
    // before settlement.
    function waitingPeriodSecs() external view returns (uint) {
        return getWaitingPeriodSecs();
    }

    // SIP-65 Decentralized Circuit Breaker
    // The factor amount expressed in decimal format
    // E.g. 3e18 = factor 3, meaning movement up to 3x and above or down to 1/3x and below
    function priceDeviationThresholdFactor() external view returns (uint) {
        return getPriceDeviationThresholdFactor();
    }

    // The raio of collateral
    // Expressed in 18 decimals. So 800% cratio is 100/800 = 0.125 (0.125e18)
    function issuanceRatio() external view returns (uint) {
        return getIssuanceRatio();
    }

    // How long a fee period lasts at a minimum. It is required for
    // anyone to roll over the periods, so they are not guaranteed
    // to roll over at exactly this duration, but the contract enforces
    // that they cannot roll over any quicker than this duration.
    function feePeriodDuration() external view returns (uint) {
        return getFeePeriodDuration();
    }

    // Users are unable to claim fees if their collateralisation ratio drifts out of target threshold
    function targetThreshold() external view returns (uint) {
        return getTargetThreshold();
    }

    // SIP-15 Liquidations
    // liquidation time delay after address flagged (seconds)
    function liquidationDelay() external view returns (uint) {
        return getLiquidationDelay();
    }

    // SIP-15 Liquidations
    // issuance ratio when account can be flagged for liquidation (with 18 decimals), e.g 0.5 issuance ratio
    // when flag means 1/0.5 = 200% cratio
    function liquidationRatio() external view returns (uint) {
        return getLiquidationRatio();
    }

    // SIP-15 Liquidations
    // penalty taken away from target of liquidation (with 18 decimals). E.g. 10% is 0.1e18
    function liquidationPenalty() external view returns (uint) {
        return getLiquidationPenalty();
    }
    /// @notice Get the reward for flagging an account for liquidation
    /// @return The reward for flagging an account
    function flagReward() external view returns (uint) {
        return getFlagReward();
    }
    // How long will the ExchangeRates contract assume the rate of any asset is correct
    function rateStalePeriod() external view returns (uint) {
        return getRateStalePeriod();
    }

    /* ========== Exchange Related Fees ========== */
    function exchangeFeeRate(bytes32 currencyKey) external view returns (uint) {
        return getExchangeFeeRate(currencyKey);
    }

    // SIP-184 Dynamic Fee
    /// @notice Get the dynamic fee threshold
    /// @return The dynamic fee threshold
    function exchangeDynamicFeeThreshold() external view returns (uint) {
        return getExchangeDynamicFeeConfig().threshold;
    }

    /// @notice Get the dynamic fee weight decay per round
    /// @return The dynamic fee weight decay per round
    function exchangeDynamicFeeWeightDecay() external view returns (uint) {
        return getExchangeDynamicFeeConfig().weightDecay;
    }

    /// @notice Get the dynamic fee total rounds for calculation
    /// @return The dynamic fee total rounds for calculation
    function exchangeDynamicFeeRounds() external view returns (uint) {
        return getExchangeDynamicFeeConfig().rounds;
    }

    /// @notice Get the max dynamic fee
    /// @return The max dynamic fee
    function exchangeMaxDynamicFee() external view returns (uint) {
        return getExchangeDynamicFeeConfig().maxFee;
    }

    /* ========== End Exchange Related Fees ========== */

    function minimumStakeTime() external view returns (uint) {
        return getMinimumStakeTime();
    }

    function debtSnapshotStaleTime() external view returns (uint) {
        return getDebtSnapshotStaleTime();
    }

    function aggregatorWarningFlags() external view returns (address) {
        return getAggregatorWarningFlags();
    }

    // SIP-63 Trading incentives
    // determines if Exchanger records fee entries in TradingRewards
    function tradingRewardsEnabled() external view returns (bool) {
        return getTradingRewardsEnabled();
    }

    function crossDomainMessageGasLimit(CrossDomainMessageGasLimits gasLimitType) external view returns (uint) {
        return getCrossDomainMessageGasLimit(gasLimitType);
    }

    function externalTokenQuota() external view returns (uint) {
        return getExternalTokenQuota();
    }

    function bridgeTransferGasCost() external view returns (uint) {
        return getBridgeTransferGasCost();
    }

    function bridgeClaimGasCost() external view returns (uint) {
        return getBridgeClaimGasCost();
    }

    function syncStaleThreshold() external view returns (uint) {
        return getSyncStaleThreshold();
    }

    function exTokenIssuanceRatio(bytes32 tokenKey) external view returns (uint) {
        return getExTokenIssuanceRatio(tokenKey);
    }

    function liquidationRatios(bytes32 tokenKey) external view returns (uint) {
        return getLiquidationRatios(tokenKey);
    }

    // ========== RESTRICTED ==========

    function setCrossDomainMessageGasLimit(CrossDomainMessageGasLimits _gasLimitType, uint _crossDomainMessageGasLimit)
        external
        onlyOwner
    {
        flexibleStorage().setCrossDomainMessageGasLimit(_getGasLimitSetting(_gasLimitType), _crossDomainMessageGasLimit);
        emit CrossDomainMessageGasLimitChanged(_gasLimitType, _crossDomainMessageGasLimit);
    }

    function setTradingRewardsEnabled(bool _tradingRewardsEnabled) external onlyOwner {
        flexibleStorage().setBoolValue(SETTING_CONTRACT_NAME, SETTING_TRADING_REWARDS_ENABLED, _tradingRewardsEnabled);
        emit TradingRewardsEnabled(_tradingRewardsEnabled);
    }

    function setWaitingPeriodSecs(uint _waitingPeriodSecs) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_WAITING_PERIOD_SECS, _waitingPeriodSecs);
        emit WaitingPeriodSecsUpdated(_waitingPeriodSecs);
    }

    function setPriceDeviationThresholdFactor(uint _priceDeviationThresholdFactor) external onlyOwner {
        flexibleStorage().setUIntValue(
            SETTING_CONTRACT_NAME,
            SETTING_PRICE_DEVIATION_THRESHOLD_FACTOR,
            _priceDeviationThresholdFactor
        );
        emit PriceDeviationThresholdUpdated(_priceDeviationThresholdFactor);
    }

    function setIssuanceRatio(uint ratio) external onlyOwner {
        flexibleStorage().setIssuanceRatio(SETTING_ISSUANCE_RATIO, ratio);
        emit IssuanceRatioUpdated(ratio);
    }

    function setFeePeriodDuration(uint _feePeriodDuration) external onlyOwner {
        flexibleStorage().setFeePeriodDuration(SETTING_FEE_PERIOD_DURATION, _feePeriodDuration);
        emit FeePeriodDurationUpdated(_feePeriodDuration);
    }

    function setTargetThreshold(uint percent) external onlyOwner {
        uint threshold = flexibleStorage().setTargetThreshold(SETTING_TARGET_THRESHOLD, percent);
        emit TargetThresholdUpdated(threshold);
    }

    function setLiquidationDelay(uint time) external onlyOwner {
        flexibleStorage().setLiquidationDelay(SETTING_LIQUIDATION_DELAY, time);
        emit LiquidationDelayUpdated(time);
    }

    // The collateral / issuance ratio ( debt / collateral ) is higher when there is less collateral backing their debt
    // Upper bound liquidationRatio is 1 + penalty (100% + 10% = 110%) to allow collateral value to cover debt and liquidation penalty
    function setLiquidationRatio(uint _liquidationRatio) external onlyOwner {
        flexibleStorage().setLiquidationRatio(
            SETTING_LIQUIDATION_RATIO,
            _liquidationRatio,
            getPeriLiquidationPenalty(),
            getIssuanceRatio()
        );
        emit LiquidationRatioUpdated(_liquidationRatio);
    }

    function setLiquidationPenalty(uint penalty) external onlyOwner {
        flexibleStorage().setLiquidationPenalty(SETTING_LIQUIDATION_PENALTY, penalty);
        emit LiquidationPenaltyUpdated(penalty);
    }

    function setRateStalePeriod(uint period) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_RATE_STALE_PERIOD, period);

        emit RateStalePeriodUpdated(period);
    }

    function setExchangeFeeRateForPynths(bytes32[] calldata pynthKeys, uint256[] calldata exchangeFeeRates)
        external
        onlyOwner
    {
         flexibleStorage().setExchangeFeeRateForPynths(SETTING_EXCHANGE_FEE_RATE, pynthKeys, exchangeFeeRates);
        for (uint i = 0; i < pynthKeys.length; i++) {
            emit ExchangeFeeUpdated(pynthKeys[i], exchangeFeeRates[i]);
        }
    }

    /// @notice Set exchange dynamic fee threshold constant in decimal ratio
    /// @param threshold The exchange dynamic fee threshold
    /// @return uint threshold constant
    function setExchangeDynamicFeeThreshold(uint threshold) external onlyOwner {
        require(threshold != 0, "Threshold cannot be 0");

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_EXCHANGE_DYNAMIC_FEE_THRESHOLD, threshold);

        emit ExchangeDynamicFeeThresholdUpdated(threshold);
    }

    /// @notice Set exchange dynamic fee weight decay constant
    /// @param weightDecay The exchange dynamic fee weight decay
    /// @return uint weight decay constant
    function setExchangeDynamicFeeWeightDecay(uint weightDecay) external onlyOwner {
        require(weightDecay != 0, "Weight decay cannot be 0");

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_EXCHANGE_DYNAMIC_FEE_WEIGHT_DECAY, weightDecay);

        emit ExchangeDynamicFeeWeightDecayUpdated(weightDecay);
    }

    /// @notice Set exchange dynamic fee last N rounds with minimum 2 rounds
    /// @param rounds The exchange dynamic fee last N rounds
    /// @return uint dynamic fee last N rounds
    function setExchangeDynamicFeeRounds(uint rounds) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_EXCHANGE_DYNAMIC_FEE_ROUNDS, rounds);

        emit ExchangeDynamicFeeRoundsUpdated(rounds);
    }

    /// @notice Set max exchange dynamic fee
    /// @param maxFee The max exchange dynamic fee
    /// @return uint dynamic fee last N rounds
    function setExchangeMaxDynamicFee(uint maxFee) external onlyOwner {
        flexibleStorage().setExchangeMaxDynamicFee(SETTING_EXCHANGE_MAX_DYNAMIC_FEE, maxFee);
        emit ExchangeMaxDynamicFeeUpdated(maxFee);
    }

    function setMinimumStakeTime(uint _seconds) external onlyOwner {
        flexibleStorage().setMinimumStakeTime(SETTING_MINIMUM_STAKE_TIME, _seconds);
        emit MinimumStakeTimeUpdated(_seconds);
    }

    function setDebtSnapshotStaleTime(uint _seconds) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_DEBT_SNAPSHOT_STALE_TIME, _seconds);
        emit DebtSnapshotStaleTimeUpdated(_seconds);
    }

    function setAggregatorWarningFlags(address _flags) external onlyOwner {
        require(_flags != address(0), "Valid address must be given");
        flexibleStorage().setAddressValue(SETTING_CONTRACT_NAME, SETTING_AGGREGATOR_WARNING_FLAGS, _flags);
        emit AggregatorWarningFlagsUpdated(_flags);
    }

    function setExternalTokenQuota(uint _newQuota) external onlyOwner {
        flexibleStorage().setExternalTokenQuota(SETTING_EXTERNAL_TOKEN_QUOTA, _newQuota);

        emit ExternalTokenQuotaUpdated(_newQuota);
    }

    function setBridgeTransferGasCost(uint _gasCost) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_BRIDGE_TRANSFER_GAS_COST, _gasCost);
    }

    function setBridgeClaimGasCost(uint _gasCost) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_BRIDGE_CLAIM_GAS_COST, _gasCost);
    }

    function setSyncStaleThreshold(uint _percent) external onlyOwner {
        flexibleStorage().setSyncStaleThreshold(SETTING_SYNC_STALE_THRESHOLD, _percent);
        emit SyncStaleThresholdUpdated(_percent);
    }

    function setExTokenIssuanceRatio(bytes32[] calldata tokenKeys, uint256[] calldata exTokenIssuanceRatios)
        external
        onlyOwner
    {
        require(tokenKeys.length == exTokenIssuanceRatios.length, "Array lengths dont match");
        for (uint i = 0; i < tokenKeys.length; i++) {
            flexibleStorage().setExTokenIssuanceRatio(SETTING_EXTOKEN_ISSUANCE_RATIO, tokenKeys[i], exTokenIssuanceRatios[i]);
            emit ExchangeFeeUpdated(tokenKeys[i], exTokenIssuanceRatios[i]);
        }
    }

    function setLiquidationRatios(bytes32[] calldata _types, uint256[] calldata _liquidationRatios) external onlyOwner {
        require(_types.length == _liquidationRatios.length, "Array lengths dont match");
        for (uint i = 0; i < _types.length; i++) {
            flexibleStorage().setLiquidationRatios(SETTING_LIQUIDATION_RATIOS, _types[i], _liquidationRatios[i], getLiquidationPenalty(), getIssuanceRatio());
            emit LiquidationRatiosUpdated(_types[i], _liquidationRatios[i]);
        }
    }

    // ========== EVENTS ==========
    event CrossDomainMessageGasLimitChanged(CrossDomainMessageGasLimits gasLimitType, uint newLimit);
    event TradingRewardsEnabled(bool enabled);
    event WaitingPeriodSecsUpdated(uint waitingPeriodSecs);
    event PriceDeviationThresholdUpdated(uint threshold);
    event IssuanceRatioUpdated(uint newRatio);
    event FeePeriodDurationUpdated(uint newFeePeriodDuration);
    event TargetThresholdUpdated(uint newTargetThreshold);
    event LiquidationDelayUpdated(uint newDelay);
    event LiquidationRatioUpdated(uint newRatio);
    event LiquidationPenaltyUpdated(uint newPenalty);
    event RateStalePeriodUpdated(uint rateStalePeriod);
    event ExchangeFeeUpdated(bytes32 pynthKey, uint newExchangeFeeRate);
    event ExchangeDynamicFeeThresholdUpdated(uint dynamicFeeThreshold);
    event ExchangeDynamicFeeWeightDecayUpdated(uint dynamicFeeWeightDecay);
    event ExchangeDynamicFeeRoundsUpdated(uint dynamicFeeRounds);
    event ExchangeMaxDynamicFeeUpdated(uint maxDynamicFee);
    /* ========== End Exchange Fees Related ========== */
    event MinimumStakeTimeUpdated(uint minimumStakeTime);
    event DebtSnapshotStaleTimeUpdated(uint debtSnapshotStaleTime);
    event AggregatorWarningFlagsUpdated(address flags);
    event ExternalTokenQuotaUpdated(uint quota);
    event SyncStaleThresholdUpdated(uint newRatio);
    event ExTokenIssuanceRatioUpdated(bytes32 pynthKey, uint exTokenIssuanceRatio);
    event LiquidationRatiosUpdated(bytes32 types, uint liquidationRatio);
}
