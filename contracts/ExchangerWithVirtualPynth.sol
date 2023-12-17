pragma solidity 0.5.16;

// Inheritance
import "./Exchanger.sol";

// Internal references
import "./interfaces/IVirtualPynth.sol";
import "./VirtualPynth.sol";

// https://docs.peri.finance/contracts/source/contracts/exchangerwithvirtualpynth
contract ExchangerWithVirtualPynth is Exchanger {
    constructor(address _owner, address _resolver) public Exchanger(_owner, _resolver) {}

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

    event VirtualPynthCreated(
        address indexed pynth,
        address indexed recipient,
        address vPynth,
        bytes32 currencyKey,
        uint amount
    );
}
