pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./State.sol";
import "./interfaces/IMultiChainDebtShareState.sol";

// Libraries
import "./SafeDecimalMath.sol";

contract MultiChainDebtShareState is Owned, State, IMultiChainDebtShareState {
    using SafeDecimalMath for uint;

    DebtShareStorage[] internal _debtShareStorage;

    constructor(address owner, address associatedContract) public Owned(owner) State(associatedContract) {}

    // View functions
    function debtShareStorageInfoAt(uint index) external view returns (uint debtShare, uint timeStamp) {
        return (debtShare = _debtShareStorage[index].debtShare, timeStamp = _debtShareStorage[index].timeStamp);
    }

    function debtShareStorageLength() external view returns (uint) {
        return _debtShareStorage.length;
    }

    function lastDebtShareStorageInfo() external view returns (uint debtShare, uint timeStamp) {
        require(_debtShareStorage.length > 0, "currently no available debtShareStorage");

        uint lastIndex = _lastDebtShareStorageIndex();
        debtShare = _debtShareStorage[lastIndex].debtShare;
        timeStamp = _debtShareStorage[lastIndex].timeStamp;
    }

    function _lastDebtShareStorageIndex() internal view returns (uint) {
        if (_debtShareStorage.length == 0) {
            return 0;
        }

        return _debtShareStorage.length - 1;
    }

    // Mutative functions
    function appendToDebtShareStorage(uint debtShare) external onlyAssociatedContract {
        DebtShareStorage memory debtShareStorage = DebtShareStorage({debtShare: debtShare, timeStamp: block.timestamp});

        _debtShareStorage.push(debtShareStorage);

        emit AppendDebtShareStorage(_lastDebtShareStorageIndex(), debtShare);
    }

    function updateDebtShareStorage(uint index, uint debtShare)
        external
        onlyAssociatedContract
        shouldEqualToZeroOrGreater(index)
    {
        _debtShareStorage[index].debtShare = debtShare;
        _debtShareStorage[index].timeStamp = block.timestamp;
    }

    function removeDebtShareStorage(uint index) external onlyAssociatedContract shouldEqualToZeroOrGreater(index) {
        delete _debtShareStorage[index];
    }

    // Modifiers
    modifier shouldEqualToZeroOrGreater(uint index) {
        require(index >= 0, "index should be greater or equal to 0");
        _;
    }

    // Events
    event AppendDebtShareStorage(uint index, uint _debtShare);
}
