import { useParams } from "react-router";

import { PaymentForm } from "./create";

export const PaymentEdit = () => {
	const { id } = useParams();

	return <PaymentForm mode="edit" paymentId={id} />;
};
