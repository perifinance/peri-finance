pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./State.sol";
import "./interfaces/ICrossChainState.sol";

// libraries
import "./Math.sol";

/**
 * @title CrossChainState
 * @author @Enitsed
 * @notice This contract saves data of All the networks staking system debt
 */
contract CrossChainState is Owned, State, ICrossChainState {
    using SafeMath for uint;

    // the total network debt and current network debt percentage
    mapping(address => CrossNetworkUserData) private _crossNetworkUserData;

    uint[] internal _totalNetworkDebtLedger;
    mapping(bytes32 => uint) private _crossNetworkIssuedDebt;
    mapping(bytes32 => uint) private _crossNetworkActiveDebt;
    bytes32[] public crossChainIds;
    bytes32 public chainId;
    mapping(bytes32 => uint) private _crossNetworkInbound;
    mapping(bytes32 => uint) private _networkIds;

    constructor(address _owner, address _associatedContract) public Owned(_owner) State(_associatedContract) {}

    // View functions

    /**
     * @notice returns the length of total network debt entry
     * @return uint
     */
    function totalNetworkDebtLedgerLength() external view returns (uint) {
        return _totalNetworkDebtLedger.length;
    }

    /**
     * @notice returns the latest total network debt
     * @return uint
     */
    function lastTotalNetworkDebtLedgerEntry() external view returns (uint) {
        return _lastTotalNetworkDebtEntry();
    }

    /**
     * @notice returns the total network debt amount at index
     * @param index uint
     * @return uint
     */
    function getTotalNetworkDebtEntryAtIndex(uint index) external view returns (uint) {
        return _getTotalNetworkDebtEntryAtIndex(index);
    }

    function getCrossNetworkUserData(address account)
        external
        view
        returns (uint crossChainDebtEntryIndex, uint userStateDebtLedgerIndex)
    {
        crossChainDebtEntryIndex = _crossNetworkUserData[account].totalNetworkDebtLedgerIndex;
        userStateDebtLedgerIndex = _crossNetworkUserData[account].userStateDebtLedgerIndex;
    }

    function _getTotalNetworkDebtEntryAtIndex(uint index) internal view returns (uint) {
        return _totalNetworkDebtLedger[index];
    }

    function _lastTotalNetworkDebtEntry() internal view returns (uint) {
        if (_totalNetworkDebtLedger.length == 0) {
            return 0;
        }

        return _totalNetworkDebtLedger[_totalNetworkDebtLedger.length - 1];
    }

    // Mutative functions

    /**
     * @notice set total network status when user's debt ownership is changed
     * @param from address
     * @param userStateDebtLedgerIndex uint
     */
    function setCrossNetworkUserData(address from, uint userStateDebtLedgerIndex) external onlyAssociatedContract {
        _crossNetworkUserData[from] = CrossNetworkUserData(_totalNetworkDebtLedger.length - 1, userStateDebtLedgerIndex);

        emit UserCrossNetworkDataUpdated(from, userStateDebtLedgerIndex, block.timestamp);
    }

    /**
     * @notice clear the user's total network debt info
     * @param from address
     */
    function clearCrossNetworkUserData(address from) external onlyAssociatedContract {
        delete _crossNetworkUserData[from];

        emit UserCrossNetworkDataRemoved(from, block.timestamp);
    }

    function appendTotalNetworkDebtLedger(uint totalNetworkDebt) external onlyAssociatedContract {
        _totalNetworkDebtLedger.push(totalNetworkDebt);

        emit TotalNetworkDebtAdded(totalNetworkDebt, block.timestamp);
    }

    function addTotalNetworkDebtLedger(uint amount) external onlyAssociatedContract {
        if (_totalNetworkDebtLedger.length == 0) {
            _totalNetworkDebtLedger.push(amount);
            emit TotalNetworkDebtAdded(amount, block.timestamp);
        } else {
            _totalNetworkDebtLedger[_totalNetworkDebtLedger.length - 1] = _lastTotalNetworkDebtEntry().add(amount);
        }
    }

    function subtractTotalNetworkDebtLedger(uint amount) external onlyAssociatedContract {
        require(_totalNetworkDebtLedger.length > 0, "total network debt should be appended first");

        _totalNetworkDebtLedger[_totalNetworkDebtLedger.length - 1] = _lastTotalNetworkDebtEntry().sub(amount);
    }

    function setCrosschain(bytes32 _chainID) external onlyAssociatedContract {
        chainId = _chainID;
        for (uint i = 0; i < crossChainIds.length; ++i) {
            if (crossChainIds[i] == _chainID) {
                return;
            }
        }
        crossChainIds.push(_chainID);
    }

    function addCrosschain(bytes32 _chainID) external onlyAssociatedContract {
        for (uint i = 0; i < crossChainIds.length; ++i) {
            if (crossChainIds[i] == _chainID) {
                return;
            }
        }
        crossChainIds.push(_chainID);
    }

    function getCrossChainIds() external view returns (bytes32[] memory) {
        return crossChainIds;
    }

    function addNetworkId(bytes32 _chainID, uint _networkId) external onlyAssociatedContract {
        if (_networkIds[_chainID] == 0) {
            _networkIds[_chainID] = _networkId;
        }
    }

    function getNetworkId(bytes32 _chainID) external view returns (uint) {
        return _networkIds[_chainID];
    }

    function setCrossNetworkIssuedDebt(bytes32 _chainID, uint amount) external onlyAssociatedContract {
        require(_chainID != chainId, "impossible to set issuedDebt of the current chain");
        _crossNetworkIssuedDebt[_chainID] = amount;
    }

    function getCrossNetworkIssuedDebt(bytes32 _chainID) external view returns (uint) {
        if (_chainID != chainId) {
            return _crossNetworkIssuedDebt[_chainID];
        }

        return 0;
    }

    function setCrossNetworkActiveDebt(bytes32 _chainID, uint amount) external onlyAssociatedContract {
        require(_chainID != chainId, "impossible to set activeDebt of the current chain");
        _crossNetworkActiveDebt[_chainID] = amount;
    }

    function getCrossNetworkActiveDebt(bytes32 _chainID) external view returns (uint) {
        if (_chainID != chainId) {
            return _crossNetworkActiveDebt[_chainID];
        }

        return 0;
    }

    function setCrossNetworkInbound(bytes32 _chainID, uint amount) external onlyAssociatedContract {
        require(_chainID != chainId, "impossible to set activeDebt of the current chain");
        _crossNetworkInbound[_chainID] = amount;
    }

    function getCrossNetworkInbound(bytes32 _chainID) external view returns (uint) {
        if (_chainID != chainId) {
            return _crossNetworkInbound[_chainID];
        }

        return 0;
    }

    function setCrossNetworkIssuedDebtAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts)
        external
        onlyAssociatedContract
    {
        for (uint i = 0; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] != chainId) {
                _crossNetworkIssuedDebt[_chainIDs[i]] = _amounts[i];
            }
        }
    }

    function getCrossNetworkIssuedDebtAll() external view returns (uint) {
        uint result = 0;
        for (uint i = 0; i < crossChainIds.length; ++i) {
            result += (_crossNetworkIssuedDebt[crossChainIds[i]]);
        }
        return result;
    }

    function setCrossNetworkActiveDebtAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts)
        external
        onlyAssociatedContract
    {
        for (uint i = 0; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] != chainId) {
                _crossNetworkActiveDebt[_chainIDs[i]] = _amounts[i];
            }
        }
    }

    function getCrossNetworkActiveDebtAll() external view returns (uint) {
        uint result = 0;
        for (uint i = 0; i < crossChainIds.length; ++i) {
            result = result.add(_crossNetworkActiveDebt[crossChainIds[i]]);
        }
        return result;
    }

    function setCrossNetworkInboundAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts)
        external
        onlyAssociatedContract
    {
        for (uint i = 0; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] != chainId) {
                _crossNetworkInbound[_chainIDs[i]] = _amounts[i];
            }
        }
    }

    function getCrossNetworkInboundAll() external view returns (uint) {
        uint result = 0;
        for (uint i = 0; i < crossChainIds.length; ++i) {
            result = result.add(_crossNetworkInbound[crossChainIds[i]]);
        }
        return result;
    }

    function setCrossNetworkDebtsAll(
        bytes32[] calldata _chainIDs,
        uint[] calldata _debts,
        uint[] calldata _activeDebts,
        uint[] calldata _inbounds
    ) external onlyAssociatedContract {
        for (uint i = 0; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] != chainId) {
                _crossNetworkIssuedDebt[_chainIDs[i]] = _debts[i];
                _crossNetworkActiveDebt[_chainIDs[i]] = _activeDebts[i];
                _crossNetworkInbound[_chainIDs[i]] = _inbounds[i];
            }
        }
    }

    function getCurrentNetworkIssuedDebt() external view returns (uint) {
        return _crossNetworkIssuedDebt[chainId];
    }

    function getTotalNetworkIssuedDebt() external view returns (uint) {
        uint result = 0;
        for (uint i = 0; i < crossChainIds.length; ++i) {
            result += (_crossNetworkIssuedDebt[crossChainIds[i]]);
        }
        // result += _crossNetworkIssuedDebt[chainId];
        return result;
    }

    function addIssuedDebt(bytes32 _chainID, uint amount) external {
        if (_crossNetworkIssuedDebt[_chainID] == 0) {
            _crossNetworkIssuedDebt[_chainID] = amount;
        } else {
            _crossNetworkIssuedDebt[_chainID] += amount;
        }
    }

    function subtractIssuedDebt(bytes32 _chainID, uint amount) external {
        if (_crossNetworkIssuedDebt[_chainID] < amount) {
            _crossNetworkIssuedDebt[_chainID] = 0;
        }
        _crossNetworkIssuedDebt[_chainID] -= amount;
    }

    function setInitialCurrentIssuedDebt(uint _amount) external onlyAssociatedContract {
        // only initial possible
        if (_crossNetworkIssuedDebt[chainId] == 0) {
            _crossNetworkIssuedDebt[chainId] = _amount;
        }
    }

    function getChainID() external view returns (bytes32) {
        return chainId;
    }

    // Events

    /**
     * @notice Emitted when totalNetworkDebt has added
     * @param totalNetworkDebt uint
     * @param timestamp uint
     */
    event TotalNetworkDebtAdded(uint totalNetworkDebt, uint timestamp);

    /**
     * @notice Emitted when user cross network data updated
     * @param account address
     * @param userStateDebtLedgerIndex uint
     * @param timestamp uint
     */
    event UserCrossNetworkDataUpdated(address account, uint userStateDebtLedgerIndex, uint timestamp);

    /**
     * @notice Emitted when user cross network data deleted
     * @param account address
     * @param timestamp uint
     */
    event UserCrossNetworkDataRemoved(address account, uint timestamp);
}
