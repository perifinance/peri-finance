pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
// Internal references

import "./interfaces/IVirtualPynth.sol";
import "./VirtualPynth.sol";
import "./interfaces/IExchanger.sol";

contract VirtualPynthIssuer is Owned, MixinResolver {
    bytes32 private constant CONTRACT_EXCHANGER = "Exchanger";

    constructor(address _owner, address _resolver) public Owned(_owner) MixinResolver(_resolver) {}

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](1);
        addresses[0] = CONTRACT_EXCHANGER;
    }

    // ========== INTERNALS ==========
    function _exchanger() internal view returns (IExchanger) {
        return IExchanger(resolver.requireAndGetAddress(CONTRACT_EXCHANGER, "Missing Exchanger address"));
    }

    function _createVirtualPynth(
        IERC20 pynth,
        address recipient,
        uint amount,
        bytes32 currencyKey
    ) internal returns (IVirtualPynth vPynth) {
        // prevent inverse pynths from being allowed due to purgeability
        require(currencyKey[0] != 0x69, "Cannot virtualize this pynth");

        vPynth = new VirtualPynth(pynth, resolver, recipient, amount, currencyKey);
        emit VirtualPynthCreated(address(pynth), recipient, address(vPynth), currencyKey, amount);
    }

    // ========== PUBLIC MUTATIVE FUNCTIONS ==========
    function createVirtualPynth(
        IERC20 pynth,
        address recipient,
        uint amount,
        bytes32 currencyKey
    ) external onlyExchanger returns (IVirtualPynth vPynth) {
        vPynth = _createVirtualPynth(pynth, recipient, amount, currencyKey);
    }

    // ========== MODIFIERS ==========
    modifier onlyExchanger() {
        require(msg.sender == address(_exchanger()), "Only Exchanger can invoke this");
        _;
    }

    // ========== EVENTS ==========

    event VirtualPynthCreated(
        address indexed pynth,
        address indexed recipient,
        address vPynth,
        bytes32 currencyKey,
        uint amount
    );
}
