import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp, createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/HomeScreen';
import { Pressable, Text, View } from 'react-native';
import CardEditScreen from './src/CardEditScreen';

import * as Linking from 'expo-linking';

import Icon from 'react-native-vector-icons/Feather';
import CardCreationScreen from './src/CardCreationScreen';
import SettingsScreen from './src/SettingsScreen';

import Modal from "react-native-modal";
import { useState } from 'react';

export type RootStackParams = {
	Home: any;
	CardEdit: {
		id: number,
	};
	CardCreation: any;
	Settings: any;
};

const RootStack = createNativeStackNavigator<RootStackParams>();

export default function App() {
	const [isModalVisible, setModalVisible] = useState(false);

	const toggleModal = () => {
		setModalVisible(!isModalVisible);
	};

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
					headerRight: () =>  {
						const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
						return(
							<View className='flex flex-row gap-7 mx-2'>
								<Pressable onPress={() => navigation.navigate('Settings')}>
									<Icon name={'settings'} size={25} />
								</Pressable>

								<Pressable onPress={() => setModalVisible(!isModalVisible) }>
									<Icon name={'coffee'} size={25} />
								</Pressable>

								<Modal isVisible={isModalVisible} onBackdropPress={() => setModalVisible(false)}>
									<View className='flex bg-white rounded-md p-4'>
										<View className='flex flex-row justify-between items-center bg-white rounded-md'>
											<Text className='text-lg font-bold'>Support the project</Text>
											<Pressable className='flex flex-row bg-gray-100 rounded-md  p-2 self-end' onPress={() => setModalVisible(false)}>
												<Icon name={'x'} size={20} />
											</Pressable>
										</View>
										
										<View className='flex p-1 py-2'>
											<Text className='text-lg'>This is an open source app with no ads nor tracking nor any paid-plans.</Text>
											<Text className='text-lg'>If you like the App and want to support the developer, please consider buying me a coffee</Text>

											<Text className='text-5xl my-8 font-bold text-center'>☕</Text>

											<Pressable className='flex flex-row bg-[#F5EFB9] rounded-md items-center justify-between p-3 my-5' onPress={() => Linking.openURL('https://www.buymeacoffee.com/benediktw')}>
												
												<Text className='text-lg font-bold'>Buy me a Coffee</Text>
												<Icon name={'external-link'} size={25} />
											</Pressable>

											<Text className='text-lg'>Thank you 😋!</Text>
										</View>
									</View>
								</Modal>
								
								<Pressable onPress={() => navigation.navigate('CardCreation')}>
									<Icon name={'plus'} size={25} />
								</Pressable>
							</View>
						)
					},
				}} />

				<RootStack.Screen name="CardEdit" component={CardEditScreen} options={{
					title: 'Edit Card',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
				}} />

				<RootStack.Screen name="CardCreation" component={CardCreationScreen} options={{
					title: 'Create Card',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
				}} />

				<RootStack.Screen name="Settings" component={SettingsScreen} options={{
					title: 'Settings',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
				}} />
			</RootStack.Navigator>
		</NavigationContainer>
    );
}