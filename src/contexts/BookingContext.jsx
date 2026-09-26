import { createContext, useContext, useReducer } from 'react';

const BookingContext = createContext();

const initialBooking = {
  step: 1,
  // Sucursal elegida (solo cuando el negocio tiene más de una).
  branchId: null,
  professionalId: null,
  serviceId: null,
  date: null,
  timeSlot: null,
  personalInfo: { name: '', phone: '', email: '', notes: '' },
  // Valores de los campos extra del negocio (ver customerFields en
  // professionPresets.js), por key. Ej: { vehicleInfo: 'Fiat Cronos ABC123' }.
  customFieldValues: {},
};

function bookingReducer(state, action) {
  switch (action.type) {
    // Cambiar de sucursal arranca la reserva de nuevo: el profesional, el
    // servicio y el horario elegidos pueden no existir en la otra.
    case 'SET_BRANCH':
      return { ...initialBooking, personalInfo: state.personalInfo, customFieldValues: state.customFieldValues, branchId: action.payload };
    case 'SET_PROFESSIONAL':
      return { ...state, professionalId: action.payload, serviceId: null, date: null, timeSlot: null };
    case 'SET_SERVICE':
      return { ...state, serviceId: action.payload, date: null, timeSlot: null };
    case 'SET_DATE':
      return { ...state, date: action.payload, timeSlot: null };
    case 'SET_TIMESLOT':
      return { ...state, timeSlot: action.payload };
    case 'SET_PERSONAL_INFO':
      return { ...state, personalInfo: { ...state.personalInfo, ...action.payload } };
    case 'SET_CUSTOM_FIELD':
      return { ...state, customFieldValues: { ...state.customFieldValues, [action.payload.key]: action.payload.value } };
    case 'SET_STEP':
      return { ...state, step: action.payload };
    case 'NEXT_STEP':
      return { ...state, step: Math.min(state.step + 1, 7) };
    case 'PREV_STEP':
      return { ...state, step: Math.max(state.step - 1, 1) };
    case 'RESET':
      return { ...initialBooking };
    default:
      return state;
  }
}

export function BookingProvider({ children }) {
  const [booking, dispatch] = useReducer(bookingReducer, initialBooking);

  return (
    <BookingContext.Provider value={{ booking, dispatch }}>
      {children}
    </BookingContext.Provider>
  );
}

export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) throw new Error('useBooking must be used within BookingProvider');
  return context;
}
