import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/HomeScreen';
import { Text } from 'react-native';
import CardEditScreen from './src/CardEditScreen';

export type RootStackParams = {
	Home: any;
	CardEdit: any;
};

const RootStack = createNativeStackNavigator<RootStackParams>();

export default function App() {
    return (
		<NavigationContainer>
			<RootStack.Navigator screenOptions={{
				animation: 'default'
			}}>
				<RootStack.Screen name="Home" component={HomeScreen} options={{
					title: 'When did I last',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
				}} />

				<RootStack.Screen name="CardEdit" component={CardEditScreen} options={{
					title: 'Edit Card',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
				}} />
			</RootStack.Navigator>
		</NavigationContainer>
    );
}