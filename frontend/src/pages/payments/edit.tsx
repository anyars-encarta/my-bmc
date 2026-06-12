import { useParams } from "react-router";
import PageLoader from "@/components/PageLoader";

import { PaymentForm } from "./create";

export const PaymentEdit = () => {
	const { id } = useParams();

	if (!id) {
		return <PageLoader />;
	}

	return <PaymentForm mode="edit" paymentId={id} />;
};
