pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// Inheritance
import "./Pynth.sol";

// Internal references
import "./interfaces/ICollateralManager.sol";
import "./interfaces/IEtherCollateralpUSD.sol";
import "./interfaces/IEtherCollateral.sol";
import "./interfaces/IBridgeState.sol";
import "./interfaces/ISystemSettings.sol";
import "./interfaces/IDebtCache.sol";

import "./SafeDecimalMath.sol";

// https://docs.peri.finance/contracts/source/contracts/multicollateralpynth
contract MultiCollateralPynth is Pynth {
    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_COLLATERALMANAGER = "CollateralManager";
    bytes32 private constant CONTRACT_ETH_COLLATERAL = "EtherCollateral";
    bytes32 private constant CONTRACT_ETH_COLLATERAL_PUSD = "EtherCollateralpUSD";
    bytes32 private constant CONTRACT_SYSTEMSETTINGS = "SystemSettings";
    bytes32 private constant CONTRACT_DEBTCACHE = "DebtCache";

    bytes32 internal constant pUSD = "pUSD";

    address payable public bridgeValidator;

    IBridgeState public bridgeState;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address payable _proxy,
        TokenState _tokenState,
        string memory _tokenName,
        string memory _tokenSymbol,
        address _owner,
        bytes32 _currencyKey,
        uint _totalSupply,
        address _resolver,
        address payable _bridgeValidator
    ) public Pynth(_proxy, _tokenState, _tokenName, _tokenSymbol, _owner, _currencyKey, _totalSupply, _resolver) {
        bridgeValidator = _bridgeValidator;
    }

    /* ========== VIEWS ======================= */

    function collateralManager() internal view returns (ICollateralManager) {
        return ICollateralManager(requireAndGetAddress(CONTRACT_COLLATERALMANAGER));
    }

    function etherCollateral() internal view returns (IEtherCollateral) {
        return IEtherCollateral(requireAndGetAddress(CONTRACT_ETH_COLLATERAL));
    }

    function etherCollateralpUSD() internal view returns (IEtherCollateralpUSD) {
        return IEtherCollateralpUSD(requireAndGetAddress(CONTRACT_ETH_COLLATERAL_PUSD));
    }

    function systemSettings() internal view returns (ISystemSettings) {
        return ISystemSettings(requireAndGetAddress(CONTRACT_SYSTEMSETTINGS));
    }

    function debtCache() internal view returns (IDebtCache) {
        return IDebtCache(requireAndGetAddress(CONTRACT_DEBTCACHE));
    }

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = Pynth.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](5);
        newAddresses[0] = CONTRACT_COLLATERALMANAGER;
        newAddresses[1] = CONTRACT_ETH_COLLATERAL;
        newAddresses[2] = CONTRACT_ETH_COLLATERAL_PUSD;
        newAddresses[3] = CONTRACT_SYSTEMSETTINGS;
        newAddresses[4] = CONTRACT_DEBTCACHE;
        addresses = combineArrays(existingAddresses, newAddresses);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /**
     * @notice Function that allows multi Collateral to issue a certain number of pynths from an account.
     * @param account Account to issue pynths to
     * @param amount Number of pynths
     */
    function issue(address account, uint amount) external onlyInternalContracts {
        super._internalIssue(account, amount);
    }

    /**
     * @notice Function that allows multi Collateral to burn a certain number of pynths from an account.
     * @param account Account to burn pynths from
     * @param amount Number of pynths
     */
    function burn(address account, uint amount) external onlyInternalContracts {
        super._internalBurn(account, amount);
    }

    // ------------- Bridge Experiment
    function overchainTransfer(
        uint _amount,
        uint _destChainId,
        IBridgeState.Signature calldata _sign
    ) external payable optionalProxy onlyAvailableWhenBridgeStateSet {
        require(_amount > 0, "Cannot transfer zero");
        require(msg.value >= systemSettings().bridgeTransferGasCost(), "fee is not sufficient");

        // any traders having traded for the past waiting period should wait for maxSecsLeftInWaitingPeriod
        _ensureCanTransfer(messageSender, _amount);

        bridgeValidator.transfer(msg.value);

        require(_internalBurn(messageSender, _amount), "burning failed");

        debtCache().updateCachedPynthDebtWithRate(pUSD, SafeDecimalMath.unit());

        bridgeState.appendOutboundingRequest(messageSender, _amount, _destChainId, _sign);
    }

    function claimAllBridgedAmounts() external payable optionalProxy onlyAvailableWhenBridgeStateSet {
        uint[] memory applicableIds = bridgeState.applicableInboundIds(messageSender);

        require(applicableIds.length > 0, "No claimable");
        require(msg.value >= systemSettings().bridgeClaimGasCost(), "fee is not sufficient");
        bridgeValidator.transfer(msg.value);

        for (uint i; i < applicableIds.length; i++) {
            require(_claimBridgedAmount(applicableIds[i]), "Failed to claim");
        }
    }

    function _claimBridgedAmount(uint _index) internal returns (bool) {
        // Validations are checked from bridge state
        (address account, uint amount, , , , ) = bridgeState.inboundings(_index);

        require(account == messageSender, "Caller is not matched");

        bridgeState.claimInbound(_index, amount);

        _internalIssue(account, amount);
        debtCache().updateCachedPynthDebtWithRate(pUSD, SafeDecimalMath.unit());

        return true;
    }

    function setBridgeState(address _newBridgeState) external onlyOwner {
        bridgeState = IBridgeState(_newBridgeState);
    }

    function setBridgeValidator(address payable _bridgeValidator) external onlyOwner {
        bridgeValidator = _bridgeValidator;
    }

    /* ========== MODIFIERS ========== */

    // Contracts directly interacting with multiCollateralPynth to issue and burn
    modifier onlyInternalContracts() {
        bool isFeePool = msg.sender == address(feePool());
        bool isExchanger = msg.sender == address(exchanger());
        bool isIssuer = msg.sender == address(issuer());
        bool ipEtherCollateral = msg.sender == address(etherCollateral());
        bool ipEtherCollateralpUSD = msg.sender == address(etherCollateralpUSD());
        bool isMultiCollateral = collateralManager().hasCollateral(msg.sender);

        require(
            isFeePool || isExchanger || isIssuer || ipEtherCollateral || ipEtherCollateralpUSD || isMultiCollateral,
            "Only FeePool, Exchanger, Issuer or MultiCollateral contracts allowed"
        );
        _;
    }

    modifier onlyAvailableWhenBridgeStateSet() {
        require(address(bridgeState) != address(0), "Bridge State must be set to call this function");
        _;
    }
}
