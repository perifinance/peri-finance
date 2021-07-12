pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./interfaces/ISystemStatus.sol";

// https://docs.peri.finance/contracts/source/contracts/systemstatus
contract SystemStatus is Owned, ISystemStatus {
    mapping(bytes32 => mapping(address => Status)) public accessControl;

    uint248 public constant SUSPENSION_REASON_UPGRADE = 1;

    bytes32 public constant SECTION_SYSTEM = "System";
    bytes32 public constant SECTION_ISSUANCE = "Issuance";
    bytes32 public constant SECTION_EXCHANGE = "Exchange";
    bytes32 public constant SECTION_PYNTH_EXCHANGE = "PynthExchange";
    bytes32 public constant SECTION_PYNTH = "Pynth";

    Suspension public systemSuspension;

    Suspension public issuanceSuspension;

    Suspension public exchangeSuspension;

    mapping(bytes32 => Suspension) public pynthExchangeSuspension;

    mapping(bytes32 => Suspension) public pynthSuspension;

    constructor(address _owner) public Owned(_owner) {}

    /* ========== VIEWS ========== */
    function requireSystemActive() external view {
        _internalRequireSystemActive();
    }

    function requireIssuanceActive() external view {
        // Issuance requires the system be active
        _internalRequireSystemActive();

        // and issuance itself of course
        _internalRequireIssuanceActive();
    }

    function requireExchangeActive() external view {
        // Exchanging requires the system be active
        _internalRequireSystemActive();

        // and exchanging itself of course
        _internalRequireExchangeActive();
    }

    function requirePynthExchangeActive(bytes32 currencyKey) external view {
        // Pynth exchange and transfer requires the system be active
        _internalRequireSystemActive();
        _internalRequirePynthExchangeActive(currencyKey);
    }

    function requirePynthActive(bytes32 currencyKey) external view {
        // Pynth exchange and transfer requires the system be active
        _internalRequireSystemActive();
        _internalRequirePynthActive(currencyKey);
    }

    function requirePynthsActive(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) external view {
        // Pynth exchange and transfer requires the system be active
        _internalRequireSystemActive();
        _internalRequirePynthActive(sourceCurrencyKey);
        _internalRequirePynthActive(destinationCurrencyKey);
    }

    function requireExchangeBetweenPynthsAllowed(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) external view {
        // Pynth exchange and transfer requires the system be active
        _internalRequireSystemActive();

        // and exchanging must be active
        _internalRequireExchangeActive();

        // and the pynth exchanging between the pynths must be active
        _internalRequirePynthExchangeActive(sourceCurrencyKey);
        _internalRequirePynthExchangeActive(destinationCurrencyKey);

        // and finally, the pynths cannot be suspended
        _internalRequirePynthActive(sourceCurrencyKey);
        _internalRequirePynthActive(destinationCurrencyKey);
    }

    function isSystemUpgrading() external view returns (bool) {
        return systemSuspension.suspended && systemSuspension.reason == SUSPENSION_REASON_UPGRADE;
    }

    function getPynthExchangeSuspensions(bytes32[] calldata pynths)
        external
        view
        returns (bool[] memory exchangeSuspensions, uint256[] memory reasons)
    {
        exchangeSuspensions = new bool[](pynths.length);
        reasons = new uint256[](pynths.length);

        for (uint i = 0; i < pynths.length; i++) {
            exchangeSuspensions[i] = pynthExchangeSuspension[pynths[i]].suspended;
            reasons[i] = pynthExchangeSuspension[pynths[i]].reason;
        }
    }

    function getPynthSuspensions(bytes32[] calldata pynths)
        external
        view
        returns (bool[] memory suspensions, uint256[] memory reasons)
    {
        suspensions = new bool[](pynths.length);
        reasons = new uint256[](pynths.length);

        for (uint i = 0; i < pynths.length; i++) {
            suspensions[i] = pynthSuspension[pynths[i]].suspended;
            reasons[i] = pynthSuspension[pynths[i]].reason;
        }
    }

    /* ========== MUTATIVE FUNCTIONS ========== */
    function updateAccessControl(
        bytes32 section,
        address account,
        bool canSuspend,
        bool canResume
    ) external onlyOwner {
        _internalUpdateAccessControl(section, account, canSuspend, canResume);
    }

    function updateAccessControls(
        bytes32[] calldata sections,
        address[] calldata accounts,
        bool[] calldata canSuspends,
        bool[] calldata canResumes
    ) external onlyOwner {
        require(
            sections.length == accounts.length &&
                accounts.length == canSuspends.length &&
                canSuspends.length == canResumes.length,
            "Input array lengths must match"
        );
        for (uint i = 0; i < sections.length; i++) {
            _internalUpdateAccessControl(sections[i], accounts[i], canSuspends[i], canResumes[i]);
        }
    }

    function suspendSystem(uint256 reason) external {
        _requireAccessToSuspend(SECTION_SYSTEM);
        systemSuspension.suspended = true;
        systemSuspension.reason = uint248(reason);
        emit SystemSuspended(systemSuspension.reason);
    }

    function resumeSystem() external {
        _requireAccessToResume(SECTION_SYSTEM);
        systemSuspension.suspended = false;
        emit SystemResumed(uint256(systemSuspension.reason));
        systemSuspension.reason = 0;
    }

    function suspendIssuance(uint256 reason) external {
        _requireAccessToSuspend(SECTION_ISSUANCE);
        issuanceSuspension.suspended = true;
        issuanceSuspension.reason = uint248(reason);
        emit IssuanceSuspended(reason);
    }

    function resumeIssuance() external {
        _requireAccessToResume(SECTION_ISSUANCE);
        issuanceSuspension.suspended = false;
        emit IssuanceResumed(uint256(issuanceSuspension.reason));
        issuanceSuspension.reason = 0;
    }

    function suspendExchange(uint256 reason) external {
        _requireAccessToSuspend(SECTION_EXCHANGE);
        exchangeSuspension.suspended = true;
        exchangeSuspension.reason = uint248(reason);
        emit ExchangeSuspended(reason);
    }

    function resumeExchange() external {
        _requireAccessToResume(SECTION_EXCHANGE);
        exchangeSuspension.suspended = false;
        emit ExchangeResumed(uint256(exchangeSuspension.reason));
        exchangeSuspension.reason = 0;
    }

    function suspendPynthExchange(bytes32 currencyKey, uint256 reason) external {
        bytes32[] memory currencyKeys = new bytes32[](1);
        currencyKeys[0] = currencyKey;
        _internalSuspendPynthExchange(currencyKeys, reason);
    }

    function suspendPynthsExchange(bytes32[] calldata currencyKeys, uint256 reason) external {
        _internalSuspendPynthExchange(currencyKeys, reason);
    }

    function resumePynthExchange(bytes32 currencyKey) external {
        bytes32[] memory currencyKeys = new bytes32[](1);
        currencyKeys[0] = currencyKey;
        _internalResumePynthsExchange(currencyKeys);
    }

    function resumePynthsExchange(bytes32[] calldata currencyKeys) external {
        _internalResumePynthsExchange(currencyKeys);
    }

    function suspendPynth(bytes32 currencyKey, uint256 reason) external {
        bytes32[] memory currencyKeys = new bytes32[](1);
        currencyKeys[0] = currencyKey;
        _internalSuspendPynths(currencyKeys, reason);
    }

    function suspendPynths(bytes32[] calldata currencyKeys, uint256 reason) external {
        _internalSuspendPynths(currencyKeys, reason);
    }

    function resumePynth(bytes32 currencyKey) external {
        bytes32[] memory currencyKeys = new bytes32[](1);
        currencyKeys[0] = currencyKey;
        _internalResumePynths(currencyKeys);
    }

    function resumePynths(bytes32[] calldata currencyKeys) external {
        _internalResumePynths(currencyKeys);
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _requireAccessToSuspend(bytes32 section) internal view {
        require(accessControl[section][msg.sender].canSuspend, "Restricted to access control list");
    }

    function _requireAccessToResume(bytes32 section) internal view {
        require(accessControl[section][msg.sender].canResume, "Restricted to access control list");
    }

    function _internalRequireSystemActive() internal view {
        require(
            !systemSuspension.suspended,
            systemSuspension.reason == SUSPENSION_REASON_UPGRADE
                ? "PeriFinance is suspended, upgrade in progress... please stand by"
                : "PeriFinance is suspended. Operation prohibited"
        );
    }

    function _internalRequireIssuanceActive() internal view {
        require(!issuanceSuspension.suspended, "Issuance is suspended. Operation prohibited");
    }

    function _internalRequireExchangeActive() internal view {
        require(!exchangeSuspension.suspended, "Exchange is suspended. Operation prohibited");
    }

    function _internalRequirePynthExchangeActive(bytes32 currencyKey) internal view {
        require(!pynthExchangeSuspension[currencyKey].suspended, "Pynth exchange suspended. Operation prohibited");
    }

    function _internalRequirePynthActive(bytes32 currencyKey) internal view {
        require(!pynthSuspension[currencyKey].suspended, "Pynth is suspended. Operation prohibited");
    }

    function _internalSuspendPynths(bytes32[] memory currencyKeys, uint256 reason) internal {
        _requireAccessToSuspend(SECTION_PYNTH);
        for (uint i = 0; i < currencyKeys.length; i++) {
            bytes32 currencyKey = currencyKeys[i];
            pynthSuspension[currencyKey].suspended = true;
            pynthSuspension[currencyKey].reason = uint248(reason);
            emit PynthSuspended(currencyKey, reason);
        }
    }

    function _internalResumePynths(bytes32[] memory currencyKeys) internal {
        _requireAccessToResume(SECTION_PYNTH);
        for (uint i = 0; i < currencyKeys.length; i++) {
            bytes32 currencyKey = currencyKeys[i];
            emit PynthResumed(currencyKey, uint256(pynthSuspension[currencyKey].reason));
            delete pynthSuspension[currencyKey];
        }
    }

    function _internalSuspendPynthExchange(bytes32[] memory currencyKeys, uint256 reason) internal {
        _requireAccessToSuspend(SECTION_PYNTH_EXCHANGE);
        for (uint i = 0; i < currencyKeys.length; i++) {
            bytes32 currencyKey = currencyKeys[i];
            pynthExchangeSuspension[currencyKey].suspended = true;
            pynthExchangeSuspension[currencyKey].reason = uint248(reason);
            emit PynthExchangeSuspended(currencyKey, reason);
        }
    }

    function _internalResumePynthsExchange(bytes32[] memory currencyKeys) internal {
        _requireAccessToResume(SECTION_PYNTH_EXCHANGE);
        for (uint i = 0; i < currencyKeys.length; i++) {
            bytes32 currencyKey = currencyKeys[i];
            emit PynthExchangeResumed(currencyKey, uint256(pynthExchangeSuspension[currencyKey].reason));
            delete pynthExchangeSuspension[currencyKey];
        }
    }

    function _internalUpdateAccessControl(
        bytes32 section,
        address account,
        bool canSuspend,
        bool canResume
    ) internal {
        require(
            section == SECTION_SYSTEM ||
                section == SECTION_ISSUANCE ||
                section == SECTION_EXCHANGE ||
                section == SECTION_PYNTH_EXCHANGE ||
                section == SECTION_PYNTH,
            "Invalid section supplied"
        );
        accessControl[section][account].canSuspend = canSuspend;
        accessControl[section][account].canResume = canResume;
        emit AccessControlUpdated(section, account, canSuspend, canResume);
    }

    /* ========== EVENTS ========== */

    event SystemSuspended(uint256 reason);
    event SystemResumed(uint256 reason);

    event IssuanceSuspended(uint256 reason);
    event IssuanceResumed(uint256 reason);

    event ExchangeSuspended(uint256 reason);
    event ExchangeResumed(uint256 reason);

    event PynthExchangeSuspended(bytes32 currencyKey, uint256 reason);
    event PynthExchangeResumed(bytes32 currencyKey, uint256 reason);

    event PynthSuspended(bytes32 currencyKey, uint256 reason);
    event PynthResumed(bytes32 currencyKey, uint256 reason);

    event AccessControlUpdated(bytes32 indexed section, address indexed account, bool canSuspend, bool canResume);
}
